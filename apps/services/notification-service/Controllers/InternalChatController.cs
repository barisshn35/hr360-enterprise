using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NotificationService.Data;
using NotificationService.Messaging;
using NotificationService.Models;

namespace NotificationService.Controllers;

/// <summary>
/// Sohbet botunun (governance-service) servisler arası uçları. Bot bildirim tablosuna doğrudan
/// yazmaz; uygulama içi bildirim bu servisin kendi modeliyle (StampTenant, denetim, push/sessiz
/// saat kuralları) oluşturulur. X-Internal-Token ile korunur (anahtar yoksa uç kapalı, 404);
/// gateway /api/*/internal/ yollarını dışarıya kapatır.
/// </summary>
[ApiController]
[AllowAnonymous]
public partial class InternalChatController : ControllerBase
{
    public const int MaxSubject = 300;
    public const int MaxBody = 4000;

    private readonly NotificationDbContext _db;
    public InternalChatController(NotificationDbContext db) => _db = db;

    [GeneratedRegex(@"^[a-z0-9][a-z0-9._-]{0,99}$")]
    private static partial Regex TemplateCodeRegex();

    /// <summary>
    /// Uygulama içi bildirim (gelen kutusu). Metni çağıran verir (bot metinleri Türkçe: dil
    /// varsayılan "tr"); kategori şablon kodundan çıkar (ör. engagement.kudos → duyurular),
    /// kişinin kapattığı kategoriler gelen kutusunda zaten gizlenir. Anlık bildirim (Web Push)
    /// ve sessiz saat, diğer uygulama içi bildirimlerdeki gibi WebPush işçisince uygulanır.
    /// </summary>
    [HttpPost("/api/internal/chat/notify")]
    public async Task<IActionResult> Notify([FromBody] InternalChatNotifyRequest request,
        [FromServices] Tenancy.TenantContext tenant, CancellationToken ct)
    {
        if (!InternalToken.Valid(Request)) return NotFound();
        var error = Validate(request);
        if (error is not null) return BadRequest(new { message = error });

        tenant.TenantSlug = request.TenantSlug;
        tenant.IsPlatformAdmin = false;
        var n = new Notification
        {
            TenantSlug = request.TenantSlug,
            RecipientEmployeeId = request.RecipientEmployeeId,
            Channel = NotificationChannel.InApp,
            TemplateCode = string.IsNullOrWhiteSpace(request.TemplateCode) ? null : request.TemplateCode.Trim(),
            Subject = string.IsNullOrWhiteSpace(request.Subject) ? null : request.Subject.Trim(),
            Body = request.Body!.Trim(),
            Language = NotificationTexts.Normalize(request.Language),
            Status = NotificationStatus.Pending,
        };
        _db.Notifications.Add(n);
        await _db.SaveChangesAsync(ct);
        return Ok(new { n.Id, status = n.Status.ToString() });
    }

    /// <summary>Kural denetimi; hata yoksa null, varsa Türkçe ileti.</summary>
    public static string? Validate(InternalChatNotifyRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.TenantSlug) || r.TenantSlug.Length > 64) return "Kiracı belirtilmedi";
        if (r.RecipientEmployeeId == Guid.Empty) return "Alıcı belirtilmedi";
        if (string.IsNullOrWhiteSpace(r.Body)) return "Bildirim metni boş olamaz";
        if (r.Body.Length > MaxBody) return $"Bildirim metni en fazla {MaxBody} karakter olabilir";
        if (r.Subject is { Length: > MaxSubject }) return $"Konu en fazla {MaxSubject} karakter olabilir";
        if (!string.IsNullOrWhiteSpace(r.TemplateCode) && !TemplateCodeRegex().IsMatch(r.TemplateCode.Trim()))
            return "Geçersiz şablon kodu";
        if (r.Language is not (null or "tr" or "en")) return "Dil 'tr' ya da 'en' olmalı.";
        return null;
    }
}

/// <summary>Servisler arası anahtar denetimi (PreferencesController.Effective ile aynı kural).</summary>
public static class InternalToken
{
    public static bool Valid(HttpRequest request)
    {
        var expected = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_TOKEN");
        var given = request.Headers["X-Internal-Token"].FirstOrDefault() ?? "";
        return !string.IsNullOrEmpty(expected) && System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(given));
    }
}

public record InternalChatNotifyRequest(string TenantSlug, Guid RecipientEmployeeId, string? Subject, string? Body,
    string? TemplateCode, string? Language = null);
