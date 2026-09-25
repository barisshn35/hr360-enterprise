using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Models;

namespace LeaveService.Controllers;

/// <summary>
/// Resmi tatil takvimi. Herkes okuyabilir (izin formundaki gun onizlemesi icin);
/// yalnizca IK ekler/siler.
/// </summary>
[ApiController]
[Route("api/public-holidays")]
[Authorize]
public class PublicHolidaysController : ControllerBase
{
    private readonly LeaveDbContext _db;
    public PublicHolidaysController(LeaveDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int? year, CancellationToken ct)
    {
        var q = _db.PublicHolidays.AsQueryable();
        if (year.HasValue) q = q.Where(h => h.Date.Year == year.Value);
        return Ok(await q.OrderBy(h => h.Date).ToListAsync(ct));
    }

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create([FromBody] CreatePublicHolidayRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 120)
            return BadRequest(new { message = "Tatil adı zorunlu ve en fazla 120 karakter olabilir" });
        if (request.Date.Year is < 2000 or > 2100)
            return BadRequest(new { message = "Geçersiz tarih" });
        if (await _db.PublicHolidays.AnyAsync(h => h.Date == request.Date, ct))
            return Conflict(new { message = "Bu tarih zaten tatil olarak kayıtlı" });

        var h = new PublicHoliday { Date = request.Date, Name = request.Name.Trim() };
        _db.PublicHolidays.Add(h);
        await _db.SaveChangesAsync(ct);
        return Created($"/api/public-holidays/{h.Id}", h);
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var h = await _db.PublicHolidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h is null) return NotFound();
        _db.PublicHolidays.Remove(h);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}

public record CreatePublicHolidayRequest(DateOnly Date, string Name);
