using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Models;
using LeaveService.Services;

namespace LeaveService.Controllers;

[ApiController]
[Route("api/leave-balances")]
[Authorize]
public class LeaveBalancesController : ControllerBase
{
    private readonly LeaveDbContext _db;
    private readonly ApprovalWorkflowClient _approvals;
    public LeaveBalancesController(LeaveDbContext db, ApprovalWorkflowClient approvals)
    {
        _db = db;
        _approvals = approvals;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId, [FromQuery] int? year, CancellationToken ct)
    {
        // GUVENLIK: Onceden her calisan tum kiracinin izin bakiyelerini (kimin ne
        // kadar hastalik/ucretsiz izin kullandigi dahil) listeleyebiliyordu. Yonetici
        // ve IK disindakiler yalnizca kendi bakiyesini gorur.
        var isManager = User.IsInRole("manager") || User.IsInRole("hr-admin")
            || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin");
        if (!isManager)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            if (employeeId.HasValue && employeeId.Value != me.Value) return Forbid();
            employeeId = me;
        }

        var q = _db.LeaveBalances.AsQueryable();
        if (employeeId.HasValue) q = q.Where(b => b.EmployeeId == employeeId.Value);
        if (year.HasValue) q = q.Where(b => b.Year == year.Value);
        return Ok(await q.OrderBy(b => b.Type).ToListAsync());
    }

    /// <summary>Yeni yil bakiyesi tanimlar veya mevcut hak edisi gunceller.</summary>
    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Upsert([FromBody] UpsertBalanceRequest request)
    {
        if (request.EntitledDays is < 0 or > 365)
            return BadRequest("Hak edilen gün 0-365 arasında olmalı");
        if (request.Year is < 2000 or > 2100)
            return BadRequest("Geçersiz yıl");
        var existing = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == request.EmployeeId && b.Year == request.Year && b.Type == request.Type);

        if (existing is null)
        {
            existing = new LeaveBalance
            {
                EmployeeId = request.EmployeeId,
                Year = request.Year,
                Type = request.Type,
                EntitledDays = request.EntitledDays
            };
            _db.LeaveBalances.Add(existing);
        }
        else
        {
            existing.EntitledDays = request.EntitledDays;
            existing.UpdatedAt = DateTimeOffset.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(existing);
    }
}

public record UpsertBalanceRequest(Guid EmployeeId, int Year, LeaveType Type, decimal EntitledDays);
