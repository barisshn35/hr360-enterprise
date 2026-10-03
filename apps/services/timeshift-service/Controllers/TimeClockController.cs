using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;
using TimeShiftService.Models;
using TimeShiftService.Services;
using TimeShiftService.Tenancy;

namespace TimeShiftService.Controllers;

/// <summary>
/// Giriş-çıkış (PDKS): QR kod, kart okuyucu ya da sicil kodu + PIN.
///
/// KVKK:
///  - Biyometrik veri (parmak izi, yüz) kullanılmaz (Kurul ilke kararı 2026/921).
///  - Konum denetimi noktaya göre isteğe bağlıdır; tarayıcıdan gelen koordinat yalnızca o
///    istekte "noktada mı" hesabı için kullanılır, veritabanına ve günlüğe yazılmaz. Saklanan
///    tek bilgi "noktada: evet/hayır"dır. Sürekli konum takibi yoktur.
///  - Kart numarası ve PIN yalnızca özet (hash) olarak tutulur.
/// </summary>
[ApiController]
[Route("api/time-clock")]
[Authorize]
public class TimeClockController : ControllerBase
{
    private const int QrWindowSeconds = 60;
    private readonly TimeShiftDbContext _db;
    private readonly EmployeeDirectoryClient _employees;
    private readonly TenantContext _tenant;

    public TimeClockController(TimeShiftDbContext db, EmployeeDirectoryClient employees, TenantContext tenant)
    {
        _db = db; _employees = employees; _tenant = tenant;
    }

    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin")
        || User.IsInRole("ext-timeshift-manage");

    // ------------------------------------------------------------------ yardımcılar

    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    private static string Sha(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();
    private static string CardHash(string tenant, string card) => Sha($"card|{tenant}|{card.Trim().ToUpperInvariant()}");

    private static string HashPin(string pin)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(pin, salt, 100_000, HashAlgorithmName.SHA256, 32);
        return $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
    }

    private static bool VerifyPin(string pin, string? stored)
    {
        if (string.IsNullOrEmpty(stored) || stored.Split('.') is not [var s, var h]) return false;
        var hash = Rfc2898DeriveBytes.Pbkdf2(pin, Convert.FromBase64String(s), 100_000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(h));
    }

    /// <summary>QR jetonu: noktaKimliği.pencere.imza — her dakika değişir; ekran görüntüsüyle sonradan kullanılamaz.</summary>
    public static string QrToken(TimeClockSite site, long window)
    {
        var sig = HMACSHA256.HashData(Encoding.UTF8.GetBytes(site.QrSecret), Encoding.UTF8.GetBytes($"{site.Id:N}.{window}"));
        return $"{site.Id:N}.{window}.{B64(sig)[..22]}";
    }

    private static long Window(DateTimeOffset t) => t.ToUnixTimeSeconds() / QrWindowSeconds;

    private async Task<(string? Error, TimeClockPunch? Punch, TimeEntry? Entry)> PunchAsync(Guid employeeId, Guid? siteId, string kind,
        TimeEntrySource method, bool? onSite, CancellationToken ct)
    {
        var at = DateTimeOffset.UtcNow;
        var open = await ClockCore.OpenEntryAsync(_db, employeeId, at, ct);
        var goingIn = kind switch { "in" => true, "out" => false, _ => open is null };
        var (err, entry) = goingIn
            ? await ClockCore.ClockInAsync(_db, employeeId, at, method, ct)
            : await ClockCore.ClockOutAsync(_db, employeeId, at, ct);
        if (err is not null) return (err, null, null);
        var p = new TimeClockPunch { EmployeeId = employeeId, SiteId = siteId, Kind = goingIn ? PunchKind.In : PunchKind.Out, Method = method, OnSite = onSite, At = at };
        _db.TimeClockPunches.Add(p);
        await _db.SaveChangesAsync(ct);
        return (null, p, entry);
    }

    // ------------------------------------------------------------------ noktalar (İK)

    public record SiteInput(string Name, bool AllowQr, bool AllowTerminal, bool CheckLocation, double? Latitude, double? Longitude, int? RadiusMeters, bool? IsActive);

    private static object SiteDto(TimeClockSite s) => new
    {
        s.Id, s.Name, s.AllowQr, s.AllowTerminal, s.CheckLocation, s.Latitude, s.Longitude, s.RadiusMeters, s.IsActive,
        hasDeviceKey = s.DeviceKeyHash != null, s.CreatedAt,
    };

    /// <summary>Noktalar: herkes adını görür (giriş ekranında seçim için); koordinatlar yalnızca İK'ya.</summary>
    [HttpGet("sites")]
    public async Task<IActionResult> Sites(CancellationToken ct)
    {
        var rows = await _db.TimeClockSites.AsNoTracking().OrderBy(s => s.Name).ToListAsync(ct);
        return IsHr ? Ok(rows.Select(SiteDto)) : Ok(rows.Where(s => s.IsActive).Select(s => new { s.Id, s.Name, s.AllowQr, s.CheckLocation }));
    }

    private IActionResult? Validate(SiteInput b)
    {
        if (string.IsNullOrWhiteSpace(b.Name) || b.Name.Length > 120) return BadRequest(new { message = "Nokta adı gerekli (en fazla 120 karakter)" });
        if (b.CheckLocation && (b.Latitude is null or < -90 or > 90 || b.Longitude is null or < -180 or > 180))
            return BadRequest(new { message = "Konum denetimi için noktanın enlem ve boylamı gerekli" });
        if (b.RadiusMeters is < 20 or > 5000) return BadRequest(new { message = "Yarıçap 20 ile 5000 metre arasında olmalı" });
        return null;
    }

    [HttpPost("sites")]
    public async Task<IActionResult> CreateSite([FromBody] SiteInput b, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        if (Validate(b) is { } bad) return bad;
        var s = new TimeClockSite
        {
            Name = b.Name.Trim(), AllowQr = b.AllowQr, AllowTerminal = b.AllowTerminal, CheckLocation = b.CheckLocation,
            Latitude = b.CheckLocation ? b.Latitude : null, Longitude = b.CheckLocation ? b.Longitude : null,
            RadiusMeters = b.RadiusMeters ?? 200, QrSecret = B64(RandomNumberGenerator.GetBytes(32)), IsActive = b.IsActive ?? true,
        };
        _db.TimeClockSites.Add(s);
        await _db.SaveChangesAsync(ct);
        return Ok(SiteDto(s));
    }

    [HttpPut("sites/{id:guid}")]
    public async Task<IActionResult> UpdateSite(Guid id, [FromBody] SiteInput b, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        if (Validate(b) is { } bad) return bad;
        var s = await _db.TimeClockSites.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        s.Name = b.Name.Trim(); s.AllowQr = b.AllowQr; s.AllowTerminal = b.AllowTerminal; s.CheckLocation = b.CheckLocation;
        s.Latitude = b.CheckLocation ? b.Latitude : null; s.Longitude = b.CheckLocation ? b.Longitude : null;
        s.RadiusMeters = b.RadiusMeters ?? s.RadiusMeters; s.IsActive = b.IsActive ?? s.IsActive;
        await _db.SaveChangesAsync(ct);
        return Ok(SiteDto(s));
    }

    [HttpDelete("sites/{id:guid}")]
    public async Task<IActionResult> DeleteSite(Guid id, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        var s = await _db.TimeClockSites.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        _db.TimeClockSites.Remove(s);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Kiosk ekranı için o anki QR jetonu (her dakika yenilenir).</summary>
    [HttpGet("sites/{id:guid}/qr")]
    public async Task<IActionResult> Qr(Guid id, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        var s = await _db.TimeClockSites.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null || !s.AllowQr || !s.IsActive) return NotFound(new { message = "Nokta QR ile giriş-çıkışa kapalı" });
        var now = DateTimeOffset.UtcNow;
        var w = Window(now);
        return Ok(new { token = QrToken(s, w), expiresAt = DateTimeOffset.FromUnixTimeSeconds((w + 1) * QrWindowSeconds), site = s.Name });
    }

    /// <summary>Kart okuyucu / PIN terminali için yeni anahtar (yalnızca bir kez gösterilir; eskisi geçersizleşir).</summary>
    [HttpPost("sites/{id:guid}/device-key")]
    public async Task<IActionResult> DeviceKey(Guid id, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        var s = await _db.TimeClockSites.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        var key = $"hrc_{_tenant.TenantSlug}_{B64(RandomNumberGenerator.GetBytes(24))}";
        s.DeviceKeyHash = Sha(key);
        await _db.SaveChangesAsync(ct);
        return Ok(new { deviceKey = key });
    }

    // ------------------------------------------------------------------ kimlik bilgileri

    public record CredentialInput(string? BadgeCode, string? CardNumber, bool? ClearCard);

    [HttpGet("credentials")]
    public async Task<IActionResult> Credentials(CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        return Ok(await _db.TimeClockCredentials.AsNoTracking()
            .Select(c => new { c.EmployeeId, c.BadgeCode, hasCard = c.CardHash != null, hasPin = c.PinHash != null, locked = c.LockedUntil > DateTimeOffset.UtcNow, c.UpdatedAt })
            .ToListAsync(ct));
    }

    /// <summary>İK: sicil kodu ve kart numarası atar (kart numarası özet olarak saklanır, geri okunamaz).</summary>
    [HttpPut("credentials/{employeeId:guid}")]
    public async Task<IActionResult> SetCredential(Guid employeeId, [FromBody] CredentialInput b, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        var tenant = _tenant.TenantSlug ?? "";
        var c = await _db.TimeClockCredentials.FirstOrDefaultAsync(x => x.EmployeeId == employeeId, ct);
        if (c is null) { c = new TimeClockCredential { EmployeeId = employeeId }; _db.TimeClockCredentials.Add(c); }
        if (b.BadgeCode is not null)
        {
            var code = b.BadgeCode.Trim();
            if (code.Length is > 0 and (< 3 or > 12) || !code.All(char.IsLetterOrDigit))
                return BadRequest(new { message = "Sicil kodu 3-12 harf/rakam olmalı" });
            if (code.Length > 0 && await _db.TimeClockCredentials.AnyAsync(x => x.BadgeCode == code && x.EmployeeId != employeeId, ct))
                return Conflict(new { message = "Bu sicil kodu başka bir çalışanda" });
            c.BadgeCode = code.Length == 0 ? null : code;
        }
        if (b.ClearCard == true) c.CardHash = null;
        else if (!string.IsNullOrWhiteSpace(b.CardNumber))
        {
            if (b.CardNumber.Trim().Length is < 4 or > 64) return BadRequest(new { message = "Kart numarası geçersiz" });
            var h = CardHash(tenant, b.CardNumber);
            if (await _db.TimeClockCredentials.AnyAsync(x => x.CardHash == h && x.EmployeeId != employeeId, ct))
                return Conflict(new { message = "Bu kart başka bir çalışana tanımlı" });
            c.CardHash = h;
        }
        c.LockedUntil = null; c.FailedPinAttempts = 0;
        c.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { c.EmployeeId, c.BadgeCode, hasCard = c.CardHash != null, hasPin = c.PinHash != null });
    }

    public record PinInput(string Pin);

    /// <summary>Çalışan kendi terminal PIN'ini belirler (4-8 rakam).</summary>
    [HttpPut("me/pin")]
    public async Task<IActionResult> SetMyPin([FromBody] PinInput b, CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return Forbid();
        if (b.Pin is null || b.Pin.Length is < 4 or > 8 || !b.Pin.All(char.IsAsciiDigit) || b.Pin.Distinct().Count() == 1)
            return BadRequest(new { message = "PIN 4-8 rakam olmalı ve tek rakamın tekrarı olmamalı" });
        var c = await _db.TimeClockCredentials.FirstOrDefaultAsync(x => x.EmployeeId == me, ct);
        if (c is null) { c = new TimeClockCredential { EmployeeId = me.Value }; _db.TimeClockCredentials.Add(c); }
        c.PinHash = HashPin(b.Pin);
        c.FailedPinAttempts = 0; c.LockedUntil = null; c.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { hasPin = true, c.BadgeCode });
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        // Çalışan kaydı olmayan hesap: giriş-çıkış yapamaz, sayfa bunu açıklar.
        if (me is null) return Ok(new { employeeId = (Guid?)null, linked = false, badgeCode = (string?)null, hasPin = false, hasCard = false, clockedIn = false, openSince = (DateTimeOffset?)null, punches = Array.Empty<object>() });
        var c = await _db.TimeClockCredentials.AsNoTracking().FirstOrDefaultAsync(x => x.EmployeeId == me, ct);
        var open = await ClockCore.OpenEntryAsync(_db, me.Value, DateTimeOffset.UtcNow, ct);
        var punches = await _db.TimeClockPunches.AsNoTracking().Where(p => p.EmployeeId == me).OrderByDescending(p => p.At).Take(20).ToListAsync(ct);
        return Ok(new { employeeId = me, linked = true, badgeCode = c?.BadgeCode, hasPin = c?.PinHash != null, hasCard = c?.CardHash != null, clockedIn = open is not null, openSince = open?.ClockIn, punches });
    }

    // ------------------------------------------------------------------ giriş-çıkış

    /// <summary>
    /// Çalışanın kendi giriş-çıkışı (web/mobil). QR jetonu (kiosk ekranından) ya da nokta seçimi.
    /// Koordinat isteğe bağlıdır ve yalnızca o noktada konum denetimi açıksa kullanılır; saklanmaz.
    /// </summary>
    public record PunchInput(string? Token, Guid? SiteId, string? Kind, double? Latitude, double? Longitude);

    [HttpPost("punch")]
    public async Task<IActionResult> Punch([FromBody] PunchInput b, CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return Forbid();
        var kind = (b.Kind ?? "auto").ToLowerInvariant();
        if (kind is not ("auto" or "in" or "out")) return BadRequest(new { message = "Geçersiz işlem" });

        TimeClockSite? site = null;
        var method = TimeEntrySource.Web;
        if (!string.IsNullOrEmpty(b.Token))
        {
            var parts = b.Token.Split('.');
            if (parts.Length != 3 || !Guid.TryParseExact(parts[0], "N", out var sid) || !long.TryParse(parts[1], out var w))
                return BadRequest(new { message = "QR kodu geçersiz", code = "qr_invalid" });
            site = await _db.TimeClockSites.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sid && x.IsActive && x.AllowQr, ct);
            var nowW = Window(DateTimeOffset.UtcNow);
            // Ekrandaki kod en fazla bir önceki pencereden olabilir (okutma anı dakika sınırına denk gelirse).
            if (site is null || w < nowW - 1 || w > nowW
                || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(QrToken(site, w)), Encoding.UTF8.GetBytes(b.Token)))
                return BadRequest(new { message = "QR kodunun süresi doldu ya da geçersiz; ekrandaki güncel kodu okutun", code = "qr_invalid" });
            method = TimeEntrySource.Qr;
        }
        else if (b.SiteId is { } id)
        {
            site = await _db.TimeClockSites.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.IsActive, ct);
            if (site is null) return NotFound(new { message = "Nokta bulunamadı" });
        }

        bool? onSite = null;
        if (site is { CheckLocation: true, Latitude: { } lat, Longitude: { } lon })
        {
            if (b.Latitude is null || b.Longitude is null)
                return BadRequest(new { message = "Bu noktada giriş-çıkış için konum izni gerekiyor (konum yalnızca o an denetlenir, saklanmaz)", code = "location_required" });
            onSite = ClockCore.DistanceMeters(lat, lon, b.Latitude.Value, b.Longitude.Value) <= site.RadiusMeters;
            if (onSite == false)
                return BadRequest(new { message = "Giriş-çıkış noktasının dışındasınız", code = "off_site" });
        }

        var (err, punch, entry) = await PunchAsync(me.Value, site?.Id, kind, method, onSite, ct);
        if (err is not null) return Conflict(new { message = err });
        return Ok(new { punch, entry, site = site?.Name });
    }

    /// <summary>
    /// Kart okuyucu / PIN terminali (kimlik doğrulaması nokta anahtarıyla). Gateway'den
    /// /api/timeshift/time-clock/terminal/punch olarak erişilir. 5 hatalı PIN'de kişi 15 dk kilitlenir.
    /// </summary>
    public record TerminalInput(string? CardNumber, string? BadgeCode, string? Pin, string? Kind);

    [HttpPost("terminal/punch")]
    [AllowAnonymous]
    public async Task<IActionResult> TerminalPunch([FromBody] TerminalInput b, CancellationToken ct)
    {
        var key = Request.Headers["X-Device-Key"].FirstOrDefault() ?? "";
        // Anahtar "hrc_<kiracı>_<rastgele>" biçiminde; kiracı anahtardan çözülür, özet karşılaştırılır.
        var segs = key.Split('_', 3);
        if (segs.Length != 3 || segs[0] != "hrc") return Unauthorized();
        _tenant.TenantSlug = segs[1];
        _tenant.IsPlatformAdmin = false;
        var hash = Sha(key);
        var site = await _db.TimeClockSites.FirstOrDefaultAsync(s => s.DeviceKeyHash == hash && s.IsActive && s.AllowTerminal, ct);
        if (site is null) return Unauthorized();

        TimeClockCredential? c;
        TimeEntrySource method;
        if (!string.IsNullOrWhiteSpace(b.CardNumber))
        {
            var h = CardHash(segs[1], b.CardNumber);
            c = await _db.TimeClockCredentials.FirstOrDefaultAsync(x => x.CardHash == h, ct);
            if (c is null) return NotFound(new { message = "Kart tanımlı değil" });
            method = TimeEntrySource.Card;
        }
        else if (!string.IsNullOrWhiteSpace(b.BadgeCode) && !string.IsNullOrEmpty(b.Pin))
        {
            c = await _db.TimeClockCredentials.FirstOrDefaultAsync(x => x.BadgeCode == b.BadgeCode.Trim(), ct);
            if (c is null) return Unauthorized(new { message = "Sicil kodu ya da PIN hatalı" });
            if (c.LockedUntil > DateTimeOffset.UtcNow) return StatusCode(423, new { message = "Çok fazla hatalı deneme; 15 dakika sonra tekrar deneyin" });
            if (!VerifyPin(b.Pin, c.PinHash))
            {
                c.FailedPinAttempts++;
                if (c.FailedPinAttempts >= 5) { c.LockedUntil = DateTimeOffset.UtcNow.AddMinutes(15); c.FailedPinAttempts = 0; }
                await _db.SaveChangesAsync(ct);
                return Unauthorized(new { message = "Sicil kodu ya da PIN hatalı" });
            }
            c.FailedPinAttempts = 0;
            method = TimeEntrySource.Pin;
        }
        else return BadRequest(new { message = "Kart ya da sicil kodu + PIN gerekli" });

        var (err, punch, _) = await PunchAsync(c.EmployeeId, site.Id, (b.Kind ?? "auto").ToLowerInvariant(), method, true, ct);
        if (err is not null) return Conflict(new { message = err });
        var name = await _db.Database.SqlQueryRaw<string>(
            "SELECT \"FirstName\" AS \"Value\" FROM employee_employees WHERE \"TenantSlug\" = {0} AND \"Id\" = {1}", segs[1], c.EmployeeId).FirstOrDefaultAsync(ct);
        // Terminal ekranında yalnızca ad ve işlem gösterilir.
        return Ok(new { kind = punch!.Kind.ToString(), at = punch.At, firstName = name, site = site.Name });
    }

    /// <summary>İK: hareket listesi (koordinat içermez).</summary>
    [HttpGet("punches")]
    public async Task<IActionResult> Punches([FromQuery] Guid? employeeId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        if (!IsHr) return Forbid();
        var q = _db.TimeClockPunches.AsNoTracking();
        if (employeeId.HasValue) q = q.Where(p => p.EmployeeId == employeeId);
        if (from.HasValue) { var f = new DateTimeOffset(from.Value.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(p => p.At >= f); }
        if (to.HasValue) { var t = new DateTimeOffset(to.Value.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero); q = q.Where(p => p.At < t); }
        return Ok(await q.OrderByDescending(p => p.At).Take(500).ToListAsync(ct));
    }
}
