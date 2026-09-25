using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.EntityFrameworkCore;
using MimeKit;
using NotificationService.Data;
using NotificationService.Models;
using NotificationService.Tenancy;

namespace NotificationService.Email;

/// <summary>
/// Pending durumundaki Email kanalli bildirimleri periyodik olarak tarar
/// ve Brevo SMTP uzerinden gonderir. Bu, tum tenant'lar icin calisan
/// sistem geneli bir arka plan isi oldugundan, kendi DbContext scope'unda
/// TenantContext.IsPlatformAdmin=true ayarlanir - boylece tenant filtresi
/// devre disi kalir ve hangi tenant'a ait olursa olsun butun bekleyen
/// bildirimler gorunur (bkz. TenantDbContextExtensions.ApplyTenantFilters).
///
/// Basarisiz gonderimler 3 denemeye kadar Pending'de birakilir (bir
/// sonraki turda tekrar denenir); 3. denemeden sonra Failed'e duser.
/// </summary>
public class EmailSenderWorker : BackgroundService
{
    private const int BatchSize = 20;
    private const int MaxAttempts = 3;
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(30);

    private readonly IServiceProvider _services;
    private readonly ILogger<EmailSenderWorker> _logger;
    private readonly EmailOptions _options;

    public EmailSenderWorker(IServiceProvider services, ILogger<EmailSenderWorker> logger, EmailOptions options)
    {
        _services = services;
        _logger = logger;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "EmailSenderWorker basladi. SMTP: {Host}:{Port}, gonderen: {From}",
            _options.SmtpHost, _options.SmtpPort, _options.FromAddress);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessBatchAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "EmailSenderWorker turu basarisiz oldu, bir sonraki turda tekrar denenecek");
            }

            await Task.Delay(PollInterval, stoppingToken);
        }
    }

    private async Task ProcessBatchAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();

        // Sistem geneli is: tum tenant'lari gormek icin filtreyi devre disi birak.
        var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenantContext.IsPlatformAdmin = true;

        var db = scope.ServiceProvider.GetRequiredService<NotificationDbContext>();

        var pending = await db.Notifications
            .Where(n => n.Channel == NotificationChannel.Email && n.Status == NotificationStatus.Pending)
            .OrderBy(n => n.CreatedAt)
            .Take(BatchSize)
            .ToListAsync(ct);

        if (pending.Count == 0) return;

        _logger.LogInformation("{Count} bekleyen e-posta bulundu, gonderiliyor", pending.Count);

        using var smtp = new SmtpClient();

        try
        {
            await smtp.ConnectAsync(_options.SmtpHost, _options.SmtpPort, SecureSocketOptions.StartTls, ct);
            await smtp.AuthenticateAsync(_options.SmtpUser, _options.SmtpPassword, ct);
        }
        catch (Exception ex)
        {
            // Baglanti/kimlik dogrulama hatasi butun batch'i etkiler - hicbir
            // notification'i Failed olarak isaretlemeden bu turu atla, bir
            // sonraki turda (30sn sonra) tekrar denenir. DB'ye hic yazilmadigi
            // icin AttemptCount de artmaz - yanlislikla Failed'e dusmezler.
            _logger.LogError(ex,
                "SMTP baglantisi/kimlik dogrulamasi basarisiz, bu tur atlaniyor - bekleyen {Count} e-posta bir sonraki turda tekrar denenecek",
                pending.Count);
            if (smtp.IsConnected)
                await smtp.DisconnectAsync(true, ct);
            return;
        }

        foreach (var notification in pending)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(notification.RecipientEmail))
                {
                    notification.Status = NotificationStatus.Failed;
                    notification.FailureReason = "Alici e-posta adresi yok";
                    continue;
                }

                var message = BuildMessage(notification);
                await smtp.SendAsync(message, ct);

                notification.Status = NotificationStatus.Sent;
                notification.SentAt = DateTimeOffset.UtcNow;
                _logger.LogInformation(
                    "E-posta gonderildi: {NotificationId} -> {Email}",
                    notification.Id, notification.RecipientEmail);
            }
            catch (Exception ex)
            {
                notification.AttemptCount++;
                notification.FailureReason = ex.Message;

                if (notification.AttemptCount >= MaxAttempts)
                {
                    notification.Status = NotificationStatus.Failed;
                    _logger.LogError(ex,
                        "E-posta gonderimi {MaxAttempts} denemede de basarisiz, Failed olarak isaretlendi: {NotificationId}",
                        MaxAttempts, notification.Id);
                }
                else
                {
                    _logger.LogWarning(ex,
                        "E-posta gonderimi basarisiz (deneme {Attempt}/{MaxAttempts}), tekrar denenecek: {NotificationId}",
                        notification.AttemptCount, MaxAttempts, notification.Id);
                }

                // Baglanti koptuysa (tek bir gonderim hatasindan farkli olarak)
                // bu turun geri kalanini da atla - hepsi ayni sebeple basarisiz olur.
                if (!smtp.IsConnected)
                {
                    _logger.LogError("SMTP baglantisi koptu, bu turun geri kalani atlaniyor");
                    break;
                }
            }
        }

        if (smtp.IsConnected)
            await smtp.DisconnectAsync(true, ct);

        await db.SaveChangesAsync(ct);
    }

    private MimeMessage BuildMessage(Notification notification)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(_options.FromName, _options.FromAddress));
        message.To.Add(MailboxAddress.Parse(notification.RecipientEmail!));
        message.Subject = notification.Subject ?? "HR360 Enterprise Bildirimi";

        var html = EmailTemplateRenderer.Render(
            subject: message.Subject,
            bodyPlainText: notification.Body);

        message.Body = new BodyBuilder
        {
            HtmlBody = html,
            TextBody = notification.Body,
        }.ToMessageBody();

        return message;
    }
}
