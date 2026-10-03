using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NotificationService.Data;
using NotificationService.Messaging;
using NotificationService.Models;
using NotificationService.Services;
using NotificationService.Tenancy;

namespace NotificationService.Controllers;

/// <summary>
/// Oturumdaki kullanıcının bildirim dili. Arayüzde dil değiştirildiğinde çağrılır;
/// sonraki e-posta ve bildirimler bu dilde üretilir.
/// </summary>
[ApiController]
[Route("api/notifications/preferences")]
[Authorize]
public class PreferencesController : ControllerBase
{
    private readonly NotificationDbContext _db;
    private readonly EmployeeDirectoryClient _employees;
    private readonly ITenantContext _tenant;
    public PreferencesController(NotificationDbContext db, EmployeeDirectoryClient employees, ITenantContext tenant)
    {
        _db = db;
        _employees = employees;
        _tenant = tenant;
    }

    public record LanguageInput(string Language);

    [HttpGet("me")]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return Ok(new { language = (string?)null, linked = false });
        var lang = await _db.Preferences.AsNoTracking().Where(p => p.EmployeeId == me).Select(p => p.Language).FirstOrDefaultAsync(ct);
        return Ok(new { language = lang, linked = true });
    }

    [HttpPut("me")]
    public async Task<IActionResult> Set(LanguageInput body, CancellationToken ct)
    {
        if (body.Language is not ("tr" or "en")) return BadRequest(new { message = "Dil 'tr' ya da 'en' olmalı." });
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        // Çalışan kaydı olmayan hesap (ör. platform yöneticisi) için saklanacak bir alıcı yok.
        if (me is null || string.IsNullOrWhiteSpace(_tenant.TenantSlug)) return Ok(new { language = body.Language, linked = false });
        var pref = await _db.Preferences.FirstOrDefaultAsync(p => p.EmployeeId == me, ct);
        if (pref is null)
        {
            // Anahtarın parçası olduğu için kiracı baştan yazılır (sonradan değiştirilemez).
            pref = new NotificationPreference { TenantSlug = _tenant.TenantSlug!, EmployeeId = me.Value };
            _db.Preferences.Add(pref);
        }
        pref.Language = NotificationTexts.Normalize(body.Language);
        pref.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { language = pref.Language, linked = true });
    }
}
