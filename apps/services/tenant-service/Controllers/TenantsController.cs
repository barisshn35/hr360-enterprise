using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;
using TenantService.Models;
using TenantService.Services;

namespace TenantService.Controllers;

/// <summary>
/// Platform yonetimi. Yalnizca platform-admin - tum tenant'lari gorur.
/// Tenant'larin kendi verisi diger servislerde, izole halde durur.
/// </summary>
[ApiController]
[Route("api/tenants")]
[Authorize(Policy = "RequirePlatformAdmin")]
public class TenantsController : ControllerBase
{
    private readonly TenantDbContext _db;
    private readonly KeycloakAdminClient _keycloak;
    private readonly ILogger<TenantsController> _logger;

    public TenantsController(TenantDbContext db, KeycloakAdminClient keycloak, ILogger<TenantsController> logger)
    {
        _db = db;
        _keycloak = keycloak;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] TenantStatus? status)
    {
        var q = _db.Tenants.AsQueryable();
        if (status.HasValue) q = q.Where(t => t.Status == status.Value);
        var tenants = await q.OrderByDescending(t => t.CreatedAt).ToListAsync();

        // NOT: Tenant modelinde EmployeeCount alani hic yoktu - frontend
        // (TenantsPage.tsx) her satirda "employeeCount ?? 0" ile sessizce
        // 0'a dusuyordu, yani platform-admin'in kota/kapasite gorunumu HER
        // kiraci icin HER ZAMAN "0 / N" gosteriyordu (MyTenantController'daki
        // ayni koku bulunan bir hatanin parcasi olarak bulundu - hardcore
        // test, 2. tur). Tum kiracilar icin TEK bir gruplu sorguyla (N+1
        // kaçınılır) employee_employees'ten (paylasilan fiziksel veritabani)
        // dogrudan sayilir.
        var counts = await _db.Database
            .SqlQuery<TenantEmployeeCount>(
                $@"SELECT ""TenantSlug"" AS ""Slug"", COUNT(*)::int AS ""Count""
                   FROM employee_employees GROUP BY ""TenantSlug""")
            .ToDictionaryAsync(c => c.Slug, c => c.Count);

        // NOT: Onceki halinde bu uc ham Tenant entity'sini donuyordu - bu,
        // frontend'in ihtiyaci olmayan SmtpPasswordEncrypted/SmtpHost/
        // SmtpUser/AdminUserId gibi ic alanlari da (parola SIFRELI olsa
        // da) platform-admin API yanitina sizdiriyordu. MyTenantController
        // ZATEN bu alanlari gizleyip sadece HasCustomSmtp donuyordu - ayni
        // guvenli deseni burada da uyguluyoruz.
        return Ok(tenants.Select(t => new
        {
            t.Id, t.Name, t.Slug, t.Status, t.Plan, t.MaxEmployees, t.CreatedAt,
            t.EmailDomain, t.TaxNumber, t.AdminEmail, t.LogoUrl, t.PrimaryColorHex,
            t.SuspendedAt,
            SuspensionReason = t.SuspendReason,
            HasCustomSmtp = t.SmtpHost != null,
            t.SmtpFromAddress, t.SmtpFromName,
            EmployeeCount = counts.GetValueOrDefault(t.Slug, 0),
        }));
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id);
        if (tenant is null) return NotFound();

        var logs = await _db.ProvisioningLogs
            .Where(l => l.TenantId == id)
            .OrderBy(l => l.OccurredAt)
            .ToListAsync();

        var employeeCount = await _db.Database
            .SqlQuery<int>($@"SELECT COUNT(*)::int AS ""Value"" FROM employee_employees
                               WHERE ""TenantSlug"" = {tenant.Slug}")
            .FirstAsync();

        // NOT: Onceki halinde bu uc { tenant: {...}, employeeCount,
        // provisioningLog } seklinde IC ICE (nested) donuyordu - ama
        // frontend'in TenantDetail tipi (api/tenant.ts) Tenant'i DUZ
        // (flat) genisletiyor ve TenantsPage.tsx alanlari dogrudan
        // "detail.data.name", "detail.data.status", "detail.data.adminEmail"
        // vb. OKUYORDU (detail.data.tenant.xxx DEGIL). Sonuc: platform-admin
        // panelinde bir kiraciya tiklayip detay actiginda "Kiraci detayi"
        // basligindan sonra TUM alanlar (durum, plan, yonetici e-postasi,
        // askiya alma bilgisi...) undefined/bos gorunuyordu (hardcore test
        // sirasinda bulundu, 2. tur). GetAll ile ayni guvenli/duz sekle
        // (SmtpPasswordEncrypted gibi ic alanlar olmadan) getiriliyor.
        return Ok(new
        {
            tenant.Id, tenant.Name, tenant.Slug, tenant.Status, tenant.Plan, tenant.MaxEmployees,
            tenant.CreatedAt, tenant.EmailDomain, tenant.TaxNumber, tenant.AdminEmail,
            tenant.LogoUrl, tenant.PrimaryColorHex, tenant.SuspendedAt,
            SuspensionReason = tenant.SuspendReason,
            HasCustomSmtp = tenant.SmtpHost != null,
            tenant.SmtpFromAddress, tenant.SmtpFromName,
            EmployeeCount = employeeCount,
            ProvisioningLog = logs,
        });
    }

    private record TenantEmployeeCount(string Slug, int Count);

    /// <summary>Tenant'i askiya alir; yonetici hesabi da devre disi birakilir.</summary>
    /// <summary>Kiracinin Keycloak organizasyonundaki tum uyeler (+ kayitli yonetici).</summary>
    private async Task<(int Affected, int Failed)> ForEachTenantUserAsync(
        Tenant tenant, Func<string, Task<bool>> action, CancellationToken ct)
    {
        var ids = new HashSet<string>();
        if (!string.IsNullOrEmpty(tenant.KeycloakOrgId))
            ids.UnionWith(await _keycloak.ListOrganizationMemberIdsAsync(tenant.KeycloakOrgId, ct));
        if (!string.IsNullOrEmpty(tenant.AdminUserId)) ids.Add(tenant.AdminUserId);
        int affected = 0, failed = 0;
        foreach (var id in ids)
        {
            try { if (await action(id)) affected++; }
            catch (Exception ex)
            {
                failed++;
                _logger.LogError(ex, "Kiraci {Slug} kullanicisi {User} guncellenemedi", tenant.Slug, id);
            }
        }
        return (affected, failed);
    }

    [HttpPost("{id}/suspend")]
    public async Task<IActionResult> Suspend(
        Guid id, [FromBody] SuspendRequest request, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tenant is null) return NotFound();
        if (tenant.Status == TenantStatus.Suspended)
            return BadRequest(new { message = "Tenant zaten askıda" });

        tenant.Status = TenantStatus.Suspended;
        tenant.SuspendedAt = DateTimeOffset.UtcNow;
        tenant.SuspendReason = request.Reason;

        // GUVENLIK: Onceden yalnizca kiraci yoneticisinin hesabi kapatiliyordu; hicbir
        // servis kiraci durumunu kontrol etmedigi icin askidaki sirketin diger tum
        // kullanicilari calismaya devam ediyordu. Artik organizasyonun tum uyeleri
        // kapatilir ve oturumlari sonlandirilir. Mevcut erisim jetonlari en fazla
        // omurleri kadar (realm ayari, varsayilan 5 dk) gecerli kalir.
        var disabled = new List<string>();
        var (affected, failed) = await ForEachTenantUserAsync(tenant, async uid =>
        {
            var changed = await _keycloak.SuspendUserForTenantAsync(uid, ct);
            if (changed) disabled.Add(uid);
            return changed;
        }, ct);
        tenant.SuspendedUserIdsJson = System.Text.Json.JsonSerializer.Serialize(disabled);

        await _db.SaveChangesAsync(ct);
        return Ok(new { tenant, usersDisabled = affected, usersFailed = failed });
    }

    [HttpPost("{id}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tenant is null) return NotFound();

        if (tenant.Status != TenantStatus.Suspended)
            return BadRequest(new { message = "Tenant askıda değil" });

        tenant.Status = TenantStatus.Active;
        tenant.SuspendedAt = null;
        tenant.SuspendReason = null;

        // Yalnizca askiya alma nedeniyle kapatilan hesaplar geri acilir; baska bir
        // nedenle kapatilmis hesaplar kapali kalir.
        var toEnable = string.IsNullOrEmpty(tenant.SuspendedUserIdsJson)
            ? new List<string>()
            : System.Text.Json.JsonSerializer.Deserialize<List<string>>(tenant.SuspendedUserIdsJson) ?? new();
        int affected = 0, failed = 0;
        var remaining = new List<string>();
        foreach (var uid in toEnable)
        {
            try { if (await _keycloak.EnableUserAsync(uid, ct)) affected++; }
            catch (Exception ex)
            {
                failed++; remaining.Add(uid);
                _logger.LogError(ex, "Kiraci {Slug} kullanicisi {User} acilamadi", tenant.Slug, uid);
            }
        }
        // Acilamayanlar kayitta kalir; islem tekrar denenebilir.
        tenant.SuspendedUserIdsJson = remaining.Count == 0 ? null : System.Text.Json.JsonSerializer.Serialize(remaining);

        await _db.SaveChangesAsync(ct);
        return Ok(new { tenant, usersEnabled = affected, usersFailed = failed });
    }

    [HttpPost("{id}/plan")]
    public async Task<IActionResult> ChangePlan(Guid id, [FromBody] ChangePlanRequest request)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id);
        if (tenant is null) return NotFound();

        tenant.Plan = request.Plan;
        tenant.MaxEmployees = request.MaxEmployees > 0
            ? request.MaxEmployees
            : request.Plan switch
            {
                TenantPlan.Trial => 25,
                TenantPlan.Standard => 250,
                TenantPlan.Enterprise => 10000,
                _ => 25,
            };

        await _db.SaveChangesAsync();
        return Ok(tenant);
    }
}

public record SuspendRequest(string? Reason);
public record ChangePlanRequest(TenantPlan Plan, int MaxEmployees);
