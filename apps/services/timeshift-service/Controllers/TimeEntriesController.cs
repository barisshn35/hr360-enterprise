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
    private readonly TimeShiftService.Services.EmployeeDirectoryClient _employees;
    public TimeEntriesController(TimeShiftDbContext db, TimeShiftService.Services.EmployeeDirectoryClient employees)
    {
        _db = db;
        _employees = employees;
    }

    /// <summary>Baskasi adina / gecmise donuk puantaj kaydi girebilen roller.</summary>
    private bool IsTimekeeper => User.IsInRole("manager") || User.IsInRole("hr-admin")
        || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin")
        || User.IsInRole("ext-timeshift-manage");

    /// <summary>
    /// Is gunu, UTC tarihine gore degil isletmenin saat dilimine gore belirlenir
    /// (HR360_TIMEZONE, varsayilan Europe/Istanbul). Onceden 00:00-03:00 arasi
    /// yapilan giris bir onceki gune yaziliyordu.
    /// </summary>
    /// <summary>
    /// Bir vardiyanin azami suresi. Daha eski acik kayit "unutulmus cikis" sayilir:
    /// calisan onu kapatamaz (23 saatlik sahte mesai olusmasin), yeniden giris
    /// yapabilir; eski kaydi yonetici/IK duzeltir. Arayuz (TimesheetPage) ayni siniri
    /// kullanir - aksi halde "Cikis yap" dugmesi kalici olarak takili kaliyordu.
    /// </summary>
    private const int MaxShiftHours = 16;

    private static readonly TimeZoneInfo BusinessZone = ResolveZone();
    private static TimeZoneInfo ResolveZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(Environment.GetEnvironmentVariable("HR360_TIMEZONE") ?? "Europe/Istanbul"); }
        catch (Exception) { return TimeZoneInfo.Utc; }
    }
    private static DateOnly WorkDate(DateTimeOffset utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utc, BusinessZone).DateTime);

    /// <summary>
    /// GUVENLIK: EmployeeId, saat (At) ve kaynak (Source) tamamen istemciden geliyordu -
    /// her calisan baskasi adina giris/cikis yapabiliyor, dunku 00:00-23:59 gibi
    /// sahte saatlerle fazla mesai uretebiliyor, Source=Device ile cihaz kaydi
    /// taklidi yapabiliyordu (canli dogrulandi). Ayrica +03:00 ofsetli bir saat
    /// Postgres'e yazilamayip 500 veriyordu. Artik yonetici/IK disindakiler yalnizca
    /// kendi adina ve SUNUCU saatiyle kayit yapar; tum saatler UTC'ye cevrilir.
    /// Donus: (hata, calisan, saat, kaynak).
    /// </summary>
    private async Task<(IActionResult? Error, Guid EmployeeId, DateTimeOffset At, TimeEntrySource Source)>
        ResolveClockAsync(ClockRequest request, CancellationToken ct)
    {
        if (IsTimekeeper)
        {
            var at = request.At == default ? DateTimeOffset.UtcNow : request.At.ToUniversalTime();
            if (at > DateTimeOffset.UtcNow.AddMinutes(5))
                return (BadRequest("Gelecek bir saat için kayıt yapılamaz"), default, default, default);
            if (at < DateTimeOffset.UtcNow.AddDays(-60))
                return (BadRequest("60 günden eski kayıt düzeltmesi bu uçtan yapılamaz"), default, default, default);
            return (null, request.EmployeeId, at, request.Source);
        }
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return (Forbid(), default, default, default);
        if (request.EmployeeId != Guid.Empty && request.EmployeeId != me.Value)
            return (StatusCode(StatusCodes.Status403Forbidden,
                new { message = "Yalnızca kendi adınıza giriş/çıkış yapabilirsiniz" }), default, default, default);
        return (null, me.Value, DateTimeOffset.UtcNow, TimeEntrySource.Manual);
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        // GUVENLIK: Onceden herkes tum kiracinin puantajini okuyabiliyordu.
        if (!IsTimekeeper)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            if (employeeId.HasValue && employeeId.Value != me.Value) return Forbid();
            employeeId = me;
        }
        var q = _db.TimeEntries.AsQueryable();
        if (employeeId.HasValue) q = q.Where(t => t.EmployeeId == employeeId.Value);
        if (from.HasValue) q = q.Where(t => t.Date >= from.Value);
        if (to.HasValue) q = q.Where(t => t.Date <= to.Value);
        return Ok(await q.OrderByDescending(t => t.Date).ToListAsync());
    }

    [HttpPost("clock-in")]
    public async Task<IActionResult> ClockIn([FromBody] ClockRequest request, CancellationToken ct)
    {
        var (error, employeeId, at, source) = await ResolveClockAsync(request, ct);
        if (error is not null) return error;

        // Kapatilmamis (cikisi yapilmamis) bir onceki kayit varsa once o kapatilmali.
        var open = await _db.TimeEntries.AnyAsync(t =>
            t.EmployeeId == employeeId && t.ClockIn != null && t.ClockOut == null
            && t.ClockIn > at.AddHours(-MaxShiftHours) && t.ClockIn <= at, ct);
        if (open) return Conflict("Açık bir giriş kaydınız var; önce çıkış yapın");

        var date = WorkDate(at);
        var entry = await _db.TimeEntries.FirstOrDefaultAsync(t =>
            t.EmployeeId == employeeId && t.Date == date, ct);

        if (entry is not null && entry.ClockIn is not null)
            return Conflict("Bu gun icin giris kaydi zaten var");

        entry ??= new TimeEntry { EmployeeId = employeeId, Date = date };
        entry.ClockIn = at;
        entry.Source = source;

        if (_db.Entry(entry).State == EntityState.Detached) _db.TimeEntries.Add(entry);
        await _db.SaveChangesAsync();
        return Ok(entry);
    }

    [HttpPost("clock-out")]
    public async Task<IActionResult> ClockOut([FromBody] ClockRequest request, CancellationToken ct)
    {
        var (error, employeeId, at, _) = await ResolveClockAsync(request, ct);
        if (error is not null) return error;

        // NOT: Onceden cikis, cikis saatinin (UTC) TARIHINE ait kayitta araniyordu -
        // gece vardiyasi (22:00 giris, ertesi gun 06:00 cikis) hic kapatilamiyordu
        // ("Once giris kaydi olusturulmali"). Artik son MaxShiftHours icindeki acik kayit kapatilir.
        var entry = await _db.TimeEntries
            .Where(t => t.EmployeeId == employeeId && t.ClockIn != null && t.ClockOut == null
                && t.ClockIn > at.AddHours(-MaxShiftHours) && t.ClockIn <= at)
            .OrderByDescending(t => t.ClockIn)
            .FirstOrDefaultAsync(ct);

        if (entry?.ClockIn is null) return BadRequest("Önce giriş kaydı oluşturulmalı");

        entry.ClockOut = at;
        var worked = (int)(at - entry.ClockIn.Value).TotalMinutes;
        entry.WorkedMinutes = worked;
        entry.OvertimeMinutes = Math.Max(0, worked - StandardWorkMinutes);

        await _db.SaveChangesAsync();
        return Ok(entry);
    }

    /// <summary>Belirli bir donem icin puantaj ozeti.</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary(
        [FromQuery] Guid employeeId, [FromQuery] int year, [FromQuery] int month, CancellationToken ct)
    {
        // Calisan kendi ozetini gorebilir (onceden yalnizca yonetici+); baskasininkini
        // yalnizca yonetici/IK. Gecersiz ay/yil onceden 500 veriyordu.
        if (!IsTimekeeper)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != employeeId) return Forbid();
        }
        if (month is < 1 or > 12 || year is < 2000 or > 2100)
            return BadRequest("Geçersiz yıl/ay");
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
