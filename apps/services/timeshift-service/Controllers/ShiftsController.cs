using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;
using TimeShiftService.Models;

namespace TimeShiftService.Controllers;

[ApiController]
[Route("api/shifts")]
[Authorize]
public class ShiftsController : ControllerBase
{
    private readonly TimeShiftDbContext _db;
    public ShiftsController(TimeShiftDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? departmentId)
    {
        var q = _db.Shifts.AsQueryable();
        if (departmentId.HasValue) q = q.Where(s => s.DepartmentId == departmentId.Value);
        return Ok(await q.OrderBy(s => s.StartTime).ToListAsync());
    }

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create([FromBody] CreateShiftRequest request)
    {
        var shift = new Shift
        {
            Name = request.Name,
            StartTime = request.StartTime,
            EndTime = request.EndTime,
            BreakMinutes = request.BreakMinutes,
            DepartmentId = request.DepartmentId,
            IsNightShift = request.EndTime < request.StartTime
        };
        _db.Shifts.Add(shift);
        await _db.SaveChangesAsync();
        return Created($"/api/shifts/{shift.Id}", shift);
    }

    [HttpPost("{id}/assign")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Assign(Guid id, [FromBody] AssignShiftRequest request)
    {
        if (!await _db.Shifts.AnyAsync(s => s.Id == id)) return NotFound("Vardiya bulunamadi");

        var existing = await _db.ShiftAssignments.FirstOrDefaultAsync(a =>
            a.EmployeeId == request.EmployeeId && a.Date == request.Date);
        if (existing is not null)
        {
            existing.ShiftId = id;
            await _db.SaveChangesAsync();
            return Ok(existing);
        }

        var assignment = new ShiftAssignment
        {
            EmployeeId = request.EmployeeId,
            ShiftId = id,
            Date = request.Date
        };
        _db.ShiftAssignments.Add(assignment);
        await _db.SaveChangesAsync();
        return Created($"/api/shifts/{id}", assignment);
    }

    [HttpGet("roster")]
    public async Task<IActionResult> GetRoster(
        [FromQuery] DateOnly from, [FromQuery] DateOnly to, [FromQuery] Guid? employeeId)
    {
        var q = _db.ShiftAssignments.Include(a => a.Shift)
            .Where(a => a.Date >= from && a.Date <= to);
        if (employeeId.HasValue) q = q.Where(a => a.EmployeeId == employeeId.Value);
        return Ok(await q.OrderBy(a => a.Date).ToListAsync());
    }
}

public record CreateShiftRequest(
    string Name, TimeOnly StartTime, TimeOnly EndTime, int BreakMinutes, Guid? DepartmentId);
public record AssignShiftRequest(Guid EmployeeId, DateOnly Date);
