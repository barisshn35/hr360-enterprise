using System.Text.Json;
using NotificationService.Data;
using NotificationService.Models;

namespace NotificationService.Messaging;

/// <summary>
/// Employee ve Workflow olaylarini dinler, ilgili kisiye bildirim uretir.
/// Bildirim yalnizca kuyruga alinir; gercek gonderim (SMTP/push) ayri bir
/// worker'in isi - bu servis "ne gonderilecek" sorusunu cevaplar.
/// </summary>
public class HrEventConsumer : KafkaConsumerBase
{
    private static readonly JsonSerializerOptions JsonOpts =
        new() { PropertyNameCaseInsensitive = true };

    public HrEventConsumer(IServiceProvider services, ILogger<HrEventConsumer> logger)
        : base(services, logger, "notification-service",
               "hr360.employee.events", "hr360.workflow.events") { }

    protected override string ConsumerName => "notification-service";

    protected override Task HandleAsync(
        string eventType, string payload, NotificationDbContext db, CancellationToken ct)
    {
        switch (eventType)
        {
            case "employee.hired":
            {
                var e = JsonSerializer.Deserialize<HiredPayload>(payload, JsonOpts);
                if (e is null) break;
                db.Notifications.Add(new Notification
                {
                    RecipientEmployeeId = e.EmployeeId,
                    RecipientEmail = e.Email,
                    Channel = NotificationChannel.Email,
                    TemplateCode = "employee.hired",
                    Subject = "Staffware'a hoş geldiniz",
                    Body = $"Merhaba {e.FirstName} {e.LastName}, " +
                           $"{e.HireDate:dd.MM.yyyy} tarihli işe başlangıcınız sisteme kaydedildi. " +
                           "İşe uyum görevleriniz Onboarding modülünde sizi bekliyor.",
                });
                break;
            }

            case "employee.assigned":
            {
                var e = JsonSerializer.Deserialize<AssignedPayload>(payload, JsonOpts);
                if (e is null) break;
                db.Notifications.Add(new Notification
                {
                    RecipientEmployeeId = e.EmployeeId,
                    RecipientEmail = e.Email,
                    Channel = NotificationChannel.Email,
                    TemplateCode = "employee.assigned",
                    Subject = "Departman atamanız güncellendi",
                    Body = $"Merhaba {e.FirstName}, {e.EffectiveFrom:dd.MM.yyyy} tarihinden geçerli " +
                           $"olmak üzere yeni pozisyonunuz: {e.PositionTitle ?? "(belirtilmemiş)"}.",
                });
                break;
            }

            case "workflow.submitted":
            {
                var e = JsonSerializer.Deserialize<SubmittedPayload>(payload, JsonOpts);
                if (e is null) break;
                var requesterText = string.IsNullOrWhiteSpace(e.RequesterName) ? "Bir çalışan" : e.RequesterName;
                var slaText = e.SlaDueAt is null ? "" : $" Son karar tarihi: {e.SlaDueAt:dd.MM.yyyy HH:mm}.";
                db.Notifications.Add(new Notification
                {
                    RecipientEmployeeId = e.ApproverEmployeeId,
                    RecipientEmail = e.ApproverEmail,
                    Channel = NotificationChannel.Email,
                    TemplateCode = "workflow.submitted",
                    Subject = "Onayınızı bekleyen bir talep var",
                    Body = $"Merhaba {e.ApproverFirstName}, {requesterText} tarafından " +
                           $"\"{e.Subject ?? e.WorkflowType}\" konulu bir talep onayınızı bekliyor.{slaText}",
                });
                break;
            }

            case "workflow.approved":
            case "workflow.rejected":
            {
                var e = JsonSerializer.Deserialize<WorkflowPayload>(payload, JsonOpts);
                if (e is null) break;
                var verdict = e.Approved ? "onaylandı" : "reddedildi";
                db.Notifications.Add(new Notification
                {
                    RecipientEmployeeId = e.RequesterEmployeeId,
                    Channel = NotificationChannel.InApp,
                    TemplateCode = eventType,
                    Subject = $"Talebiniz {verdict}",
                    Body = $"\"{e.Subject ?? e.WorkflowType}\" talebiniz {verdict}." +
                           (string.IsNullOrWhiteSpace(e.Comment)
                                ? ""
                                : $" Gerekçe: {e.Comment}"),
                });
                break;
            }
        }

        return Task.CompletedTask;
    }

    private record HiredPayload(
        Guid EmployeeId, string FirstName, string LastName, string Email,
        DateOnly HireDate, DateTimeOffset OccurredAt);

    private record SubmittedPayload(
        Guid WorkflowRequestId, string WorkflowType, Guid RequesterEmployeeId,
        string? RequesterName, string? Subject, Guid ApproverEmployeeId,
        string ApproverEmail, string ApproverFirstName, DateTimeOffset? SlaDueAt,
        DateTimeOffset OccurredAt);

    private record AssignedPayload(
        Guid EmployeeId, Guid AssignmentId, Guid DepartmentId,
        string? PositionTitle, DateOnly EffectiveFrom, DateTimeOffset OccurredAt,
        string Email, string FirstName, string LastName);

    private record WorkflowPayload(
        Guid WorkflowRequestId, string WorkflowType, Guid RequesterEmployeeId,
        string? Subject, bool Approved, Guid DecidedByEmployeeId,
        string? Comment, DateTimeOffset OccurredAt);
}
