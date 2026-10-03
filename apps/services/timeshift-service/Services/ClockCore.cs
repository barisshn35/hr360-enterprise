using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;
using TimeShiftService.Models;

namespace TimeShiftService.Services;

/// <summary>
/// Giriş-çıkış çekirdeği: web ucu (TimeEntriesController), QR/konum ve kart/PIN terminali
/// (TimeClockController) aynı kuralları kullanır.
/// </summary>
public static class ClockCore
{
    public const int StandardWorkMinutes = 480; // 8 saat

    /// <summary>
    /// Bir vardiyanin azami suresi. Daha eski acik kayit "unutulmus cikis" sayilir:
    /// calisan onu kapatamaz (23 saatlik sahte mesai olusmasin), yeniden giris
    /// yapabilir; eski kaydi yonetici/IK duzeltir.
    /// </summary>
    public const int MaxShiftHours = 16;

    /// <summary>İş günü işletmenin saat dilimine göre belirlenir (HR360_TIMEZONE, varsayılan Europe/Istanbul).</summary>
    public static readonly TimeZoneInfo BusinessZone = ResolveZone();
    private static TimeZoneInfo ResolveZone()
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(Environment.GetEnvironmentVariable("HR360_TIMEZONE") ?? "Europe/Istanbul"); }
        catch (Exception) { return TimeZoneInfo.Utc; }
    }
    public static DateOnly WorkDate(DateTimeOffset utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utc, BusinessZone).DateTime);

    public static Task<TimeEntry?> OpenEntryAsync(TimeShiftDbContext db, Guid employeeId, DateTimeOffset at, CancellationToken ct) =>
        db.TimeEntries
            .Where(t => t.EmployeeId == employeeId && t.ClockIn != null && t.ClockOut == null
                && t.ClockIn > at.AddHours(-MaxShiftHours) && t.ClockIn <= at)
            .OrderByDescending(t => t.ClockIn)
            .FirstOrDefaultAsync(ct);

    /// <summary>Giriş. Hata iletisi ya da kayıt.</summary>
    public static async Task<(string? Error, TimeEntry? Entry)> ClockInAsync(TimeShiftDbContext db, Guid employeeId, DateTimeOffset at,
        TimeEntrySource source, CancellationToken ct)
    {
        if (await OpenEntryAsync(db, employeeId, at, ct) is not null)
            return ("Açık bir giriş kaydınız var; önce çıkış yapın", null);
        var date = WorkDate(at);
        var entry = await db.TimeEntries.FirstOrDefaultAsync(t => t.EmployeeId == employeeId && t.Date == date, ct);
        if (entry is not null && entry.ClockIn is not null)
            return ("Bu gün için giriş kaydı zaten var", null);
        entry ??= new TimeEntry { EmployeeId = employeeId, Date = date };
        entry.ClockIn = at;
        entry.Source = source;
        if (db.Entry(entry).State == EntityState.Detached) db.TimeEntries.Add(entry);
        return (null, entry);
    }

    /// <summary>Çıkış: son MaxShiftHours içindeki açık kayıt kapatılır (gece vardiyası dahil).</summary>
    public static async Task<(string? Error, TimeEntry? Entry)> ClockOutAsync(TimeShiftDbContext db, Guid employeeId, DateTimeOffset at, CancellationToken ct)
    {
        var entry = await OpenEntryAsync(db, employeeId, at, ct);
        if (entry?.ClockIn is null) return ("Önce giriş kaydı oluşturulmalı", null);
        entry.ClockOut = at;
        var worked = (int)(at - entry.ClockIn.Value).TotalMinutes;
        entry.WorkedMinutes = worked;
        entry.OvertimeMinutes = Math.Max(0, worked - StandardWorkMinutes);
        return (null, entry);
    }

    /// <summary>İki nokta arası uzaklık (metre, haversine).</summary>
    public static double DistanceMeters(double lat1, double lon1, double lat2, double lon2)
    {
        const double R = 6371000;
        double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(lat2 - lat1);
        var dLon = Rad(lon2 - lon1);
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2) + Math.Cos(Rad(lat1)) * Math.Cos(Rad(lat2)) * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return 2 * R * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }
}
