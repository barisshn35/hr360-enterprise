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
        return Ok(await q.OrderByDescending(t => t.CreatedAt).ToListAsync());
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

        return Ok(new { tenant, provisioningLog = logs });
    }

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
