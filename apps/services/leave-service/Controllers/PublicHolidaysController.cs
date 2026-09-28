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

    /// <summary>
    /// Sabit tarihli ulusal bayramlar (her yil ayni). 28 Ekim ve bayram arefeleri yarim
    /// gun oldugundan listede yok - sistem yarim gun tatili desteklemiyor.
    /// </summary>
    private static readonly (int Month, int Day, string Name)[] FixedTurkishHolidays =
    {
        (1, 1, "Yılbaşı"),
        (4, 23, "Ulusal Egemenlik ve Çocuk Bayramı"),
        (5, 1, "Emek ve Dayanışma Günü"),
        (5, 19, "Atatürk'ü Anma, Gençlik ve Spor Bayramı"),
        (7, 15, "Demokrasi ve Millî Birlik Günü"),
        (8, 30, "Zafer Bayramı"),
        (10, 29, "Cumhuriyet Bayramı"),
    };

    /// <summary>
    /// Dini bayramlar (hicri takvime gore her yil degisir). Kaynak: Diyanet Isleri
    /// Baskanligi dini gunler listesi (vakithesaplama.diyanet.gov.tr), 2026 ve 2027.
    /// Diger yillar icin IK tarihleri elle girer.
    /// </summary>
    private static readonly Dictionary<int, (string Date, string Name)[]> ReligiousTurkishHolidays = new()
    {
        [2026] = new[]
        {
            ("2026-03-20", "Ramazan Bayramı (1. gün)"), ("2026-03-21", "Ramazan Bayramı (2. gün)"),
            ("2026-03-22", "Ramazan Bayramı (3. gün)"),
            ("2026-05-27", "Kurban Bayramı (1. gün)"), ("2026-05-28", "Kurban Bayramı (2. gün)"),
            ("2026-05-29", "Kurban Bayramı (3. gün)"), ("2026-05-30", "Kurban Bayramı (4. gün)"),
        },
        [2027] = new[]
        {
            ("2027-03-09", "Ramazan Bayramı (1. gün)"), ("2027-03-10", "Ramazan Bayramı (2. gün)"),
            ("2027-03-11", "Ramazan Bayramı (3. gün)"),
            ("2027-05-16", "Kurban Bayramı (1. gün)"), ("2027-05-17", "Kurban Bayramı (2. gün)"),
            ("2027-05-18", "Kurban Bayramı (3. gün)"), ("2027-05-19", "Kurban Bayramı (4. gün)"),
        },
    };

    /// <summary>
    /// Verilen yilin Turkiye resmi tatillerini ekler (zaten kayitli tarihler atlanir).
    /// Ayni gune denk gelen iki tatil tek kayit olur, adlari birlestirilir.
    /// </summary>
    [HttpPost("seed-tr")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> SeedTurkish([FromQuery] int year, CancellationToken ct)
    {
        if (year is < 2000 or > 2100) return BadRequest(new { message = "Geçersiz yıl" });

        var byDate = new SortedDictionary<DateOnly, string>();
        foreach (var (m, d, name) in FixedTurkishHolidays)
            byDate[new DateOnly(year, m, d)] = name;
        var hasReligious = ReligiousTurkishHolidays.TryGetValue(year, out var religious);
        foreach (var (date, name) in religious ?? Array.Empty<(string, string)>())
        {
            var dt = DateOnly.Parse(date);
            byDate[dt] = byDate.TryGetValue(dt, out var existing) ? $"{existing} / {name}" : name;
        }

        var existingDates = (await _db.PublicHolidays
            .Where(h => h.Date.Year == year).Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var added = 0;
        foreach (var (date, name) in byDate)
        {
            if (existingDates.Contains(date)) continue;
            _db.PublicHolidays.Add(new PublicHoliday { Date = date, Name = name });
            added++;
        }
        await _db.SaveChangesAsync(ct);

        return Ok(new
        {
            added,
            skipped = byDate.Count - added,
            religiousIncluded = hasReligious,
            message = hasReligious
                ? $"{added} tatil eklendi."
                : $"{added} sabit tarihli tatil eklendi. {year} için Ramazan ve Kurban Bayramı tarihlerini elle girin.",
        });
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
