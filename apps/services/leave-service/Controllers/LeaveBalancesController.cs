using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Models;

namespace LeaveService.Controllers;

[ApiController]
[Route("api/leave-balances")]
[Authorize]
public class LeaveBalancesController : ControllerBase
{
    private readonly LeaveDbContext _db;
    public LeaveBalancesController(LeaveDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId, [FromQuery] int? year)
    {
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
