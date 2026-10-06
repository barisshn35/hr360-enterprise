using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;
using TimeShiftService.Models;
using TimeShiftService.Services;

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
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(new { message = "Vardiya adı zorunlu" });
        if (request.StartTime == request.EndTime) return BadRequest(new { message = "Başlangıç ve bitiş saati aynı olamaz" });
        if (request.BreakMinutes is < 0 or > 240) return BadRequest(new { message = "Mola 0–240 dakika olmalı" });
        var span = request.EndTime > request.StartTime
            ? request.EndTime - request.StartTime
            : TimeSpan.FromHours(24) - (request.StartTime - request.EndTime);
        if (request.BreakMinutes >= span.TotalMinutes) return BadRequest(new { message = "Mola vardiya süresinden kısa olmalı" });
        var shift = new Shift
        {
            Name = request.Name.Trim(),
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

    /// <summary>
    /// Vardiya tanımını siler. Atama kaydı varsa (geçmiş puantaj ve takas talepleri ona bağlı)
    /// silinmez: ilişki veritabanında cascade olduğundan sessiz veri kaybını önlemek için 409.
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id);
        if (shift is null) return NotFound();
        var used = await _db.ShiftAssignments.CountAsync(a => a.ShiftId == id);
        if (used > 0)
            return Conflict(new { message = $"Bu vardiyaya {used} atama bağlı; vardiya tanımı silinemez" });
        _db.Shifts.Remove(shift);
        await _db.SaveChangesAsync();
        return NoContent();
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

    /// <summary>
    /// Madde 66: atama/taşıma öncesi çalışma süresi kural uyarıları (11 saat dinlenme, günlük/haftalık
    /// süre, gece 7,5 saat, ardışık gün). Vardiya tanımı (ShiftId) ya da saatler (Start/End/Break) verilir.
    /// Uyarıdır; atamayı engellemez.
    /// </summary>
    [HttpPost("rule-check")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> RuleCheck([FromBody] RuleCheckRequest b, CancellationToken ct)
    {
        TimeOnly start, end;
        int brk;
        if (b.ShiftId is { } sid)
        {
            var shift = await _db.Shifts.AsNoTracking().FirstOrDefaultAsync(s => s.Id == sid, ct);
            if (shift is null) return NotFound(new { message = "Vardiya bulunamadı" });
            (start, end, brk) = (shift.StartTime, shift.EndTime, shift.BreakMinutes);
        }
        else if (b.StartTime is { } st && b.EndTime is { } en && st != en)
            (start, end, brk) = (st, en, Math.Clamp(b.BreakMinutes ?? 0, 0, 240));
        else return BadRequest(new { message = "Vardiya ya da başlangıç-bitiş saati gerekli" });
        var warnings = await WorkRuleCheck.ForAssignmentAsync(_db, b.EmployeeId, b.Date, start, end, brk, await WorkRuleCheck.RulesAsync(_db, ct), ct);
        return Ok(new { warnings = warnings.Select(w => new { w.Code, w.Message }) });
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
public record RuleCheckRequest(Guid EmployeeId, DateOnly Date, Guid? ShiftId, TimeOnly? StartTime, TimeOnly? EndTime, int? BreakMinutes);
