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

    public TenantsController(TenantDbContext db, KeycloakAdminClient keycloak)
    {
        _db = db;
        _keycloak = keycloak;
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

        if (tenant.AdminUserId is not null)
            await _keycloak.SetUserEnabledAsync(tenant.AdminUserId, false, ct);

        await _db.SaveChangesAsync(ct);
        return Ok(tenant);
    }

    [HttpPost("{id}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct)
    {
        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tenant is null) return NotFound();

        tenant.Status = TenantStatus.Active;
        tenant.SuspendedAt = null;
        tenant.SuspendReason = null;

        if (tenant.AdminUserId is not null)
            await _keycloak.SetUserEnabledAsync(tenant.AdminUserId, true, ct);

        await _db.SaveChangesAsync(ct);
        return Ok(tenant);
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
