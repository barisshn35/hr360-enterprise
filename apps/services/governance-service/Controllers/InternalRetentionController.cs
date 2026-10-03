using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;

namespace GovernanceService.Controllers;

/// <summary>
/// Yedekten geri yükleme sonrası (scripts/restore.sh): tüm kiracıların etkin saklama politikaları
/// hemen yeniden çalıştırılır; yedekten sonra imha edilmiş kayıtlar yeniden silinir/anonimleşir.
/// İmha tutanağına "Restore" tetikleyicisiyle yazılır. INTERNAL_SERVICE_TOKEN ile korunur;
/// gateway /api/*/internal/ yollarını dışarıya kapatır.
/// </summary>
[ApiController]
[Route("api/internal/retention")]
[AllowAnonymous]
public class InternalRetentionController : ControllerBase
{
    private readonly GovernanceDbContext _db;
    private readonly Sql _sql;
    private readonly Tenancy.TenantContext _tenant;
    public InternalRetentionController(GovernanceDbContext db, Sql sql, Tenancy.TenantContext tenant) { _db = db; _sql = sql; _tenant = tenant; }

    [HttpPost("run")]
    public async Task<IActionResult> Run(CancellationToken ct)
    {
        var expected = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_TOKEN");
        var given = Request.Headers["X-Internal-Token"].FirstOrDefault() ?? "";
        if (string.IsNullOrEmpty(expected) || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(given)))
            return NotFound();
        _tenant.IsPlatformAdmin = true;
        var policies = await _db.RetentionPolicies.IgnoreQueryFilters().Where(p => p.IsEnabled).ToListAsync(ct);
        var total = 0;
        foreach (var p in policies)
        {
            p.LastAffected = await Retention.RunAsync(_sql, p, ct);
            p.LastRunAt = DateTime.UtcNow;
            total += p.LastAffected;
            Retention.Log(_db, p.TenantSlug, p.Category, p.Action, p.LastAffected, p.RetentionMonths, "Restore", "Sistem (yedekten geri yükleme sonrası)");
        }
        await _db.SaveChangesAsync(ct);
        return Ok(new { policies = policies.Count, affected = total });
    }
}
