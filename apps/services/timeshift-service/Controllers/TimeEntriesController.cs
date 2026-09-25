using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;
using TimeShiftService.Models;

namespace TimeShiftService.Controllers;

[ApiController]
[Route("api/time-entries")]
[Authorize]
public class TimeEntriesController : ControllerBase
{
    private const int StandardWorkMinutes = 480; // 8 saat

    private readonly TimeShiftDbContext _db;
    public TimeEntriesController(TimeShiftDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to)
    {
        var q = _db.TimeEntries.AsQueryable();
        if (employeeId.HasValue) q = q.Where(t => t.EmployeeId == employeeId.Value);
        if (from.HasValue) q = q.Where(t => t.Date >= from.Value);
        if (to.HasValue) q = q.Where(t => t.Date <= to.Value);
        return Ok(await q.OrderByDescending(t => t.Date).ToListAsync());
    }

    [HttpPost("clock-in")]
    public async Task<IActionResult> ClockIn([FromBody] ClockRequest request)
    {
        var date = DateOnly.FromDateTime(request.At.UtcDateTime);
        var entry = await _db.TimeEntries.FirstOrDefaultAsync(t =>
            t.EmployeeId == request.EmployeeId && t.Date == date);

        if (entry is not null && entry.ClockIn is not null)
            return Conflict("Bu gun icin giris kaydi zaten var");

        entry ??= new TimeEntry { EmployeeId = request.EmployeeId, Date = date };
        entry.ClockIn = request.At;
        entry.Source = request.Source;

        if (_db.Entry(entry).State == EntityState.Detached) _db.TimeEntries.Add(entry);
        await _db.SaveChangesAsync();
        return Ok(entry);
    }

    [HttpPost("clock-out")]
    public async Task<IActionResult> ClockOut([FromBody] ClockRequest request)
    {
        var date = DateOnly.FromDateTime(request.At.UtcDateTime);
        var entry = await _db.TimeEntries.FirstOrDefaultAsync(t =>
            t.EmployeeId == request.EmployeeId && t.Date == date);

        if (entry?.ClockIn is null) return BadRequest("Önce giriş kaydı oluşturulmalı");
        if (entry.ClockOut is not null) return Conflict("Cikis kaydi zaten var");
        if (request.At < entry.ClockIn) return BadRequest("Cikis, giristen once olamaz");

        entry.ClockOut = request.At;
        var worked = (int)(request.At - entry.ClockIn.Value).TotalMinutes;
        entry.WorkedMinutes = worked;
        entry.OvertimeMinutes = Math.Max(0, worked - StandardWorkMinutes);

        await _db.SaveChangesAsync();
        return Ok(entry);
    }

    /// <summary>Belirli bir donem icin puantaj ozeti.</summary>
    [HttpGet("summary")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> GetSummary(
        [FromQuery] Guid employeeId, [FromQuery] int year, [FromQuery] int month)
    {
        var from = new DateOnly(year, month, 1);
        var to = from.AddMonths(1).AddDays(-1);

        var entries = await _db.TimeEntries
            .Where(t => t.EmployeeId == employeeId && t.Date >= from && t.Date <= to)
            .ToListAsync();

        return Ok(new
        {
            employeeId,
            year,
            month,
            daysWorked = entries.Count(e => e.WorkedMinutes > 0),
            totalWorkedMinutes = entries.Sum(e => e.WorkedMinutes),
            totalOvertimeMinutes = entries.Sum(e => e.OvertimeMinutes),
            entries = entries.OrderBy(e => e.Date)
        });
    }
}

public record ClockRequest(
    Guid EmployeeId, DateTimeOffset At, TimeEntrySource Source = TimeEntrySource.Manual);
