using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Models;

namespace ExpenseService.Services;

/// <summary>
/// TCMB gösterge kurları (döviz alış). Gün için dosya: {TCMB_RATES_URL}/{yyyyMM}/{ddMMyyyy}.xml,
/// bugün için today.xml. Hafta sonu/tatilde dosya yoktur: önceki iş gününün kuru kullanılır
/// (en fazla 7 gün geriye). Kurlar veritabanında önbelleklenir; İK elle kur girebilir.
/// </summary>
public sealed class FxService
{
    private readonly HttpClient _http;
    private readonly ILogger<FxService> _log;
    public static readonly string BaseUrl = (Environment.GetEnvironmentVariable("TCMB_RATES_URL") ?? "https://www.tcmb.gov.tr/kurlar").TrimEnd('/');
    public FxService(HttpClient http, ILogger<FxService> log) { _http = http; _log = log; _http.Timeout = TimeSpan.FromSeconds(10); }

    public static Dictionary<string, decimal> Parse(string xml)
    {
        var doc = XDocument.Parse(xml);
        var map = new Dictionary<string, decimal>();
        foreach (var c in doc.Descendants("Currency"))
        {
            var code = c.Attribute("CurrencyCode")?.Value ?? c.Attribute("Kod")?.Value;
            var unit = decimal.TryParse(c.Element("Unit")?.Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var u) && u > 0 ? u : 1;
            var raw = c.Element("ForexBuying")?.Value;
            if (code is null || !decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var rate) || rate <= 0) continue;
            map[code.ToUpperInvariant()] = Math.Round(rate / unit, 6);
        }
        return map;
    }

    /// <summary>Kur: önce kiracının elle girdiği, sonra önbellekteki TCMB kuru, yoksa TCMB'den çeker.</summary>
    public async Task<(decimal Rate, DateOnly Date, string Source)?> RateAsync(ExpenseDbContext db, string? tenant, string currency, DateOnly date, CancellationToken ct)
    {
        currency = currency.ToUpperInvariant();
        if (currency == "TRY") return (1m, date, "TRY");
        // Gelecek tarih için kur yok: bugünün (son yayımlanan) kuru kullanılır.
        var todayTr = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        if (date > todayTr) date = todayTr;
        for (var i = 0; i <= 7; i++)
        {
            var d = date.AddDays(-i);
            var manual = await db.FxRates.AsNoTracking().FirstOrDefaultAsync(r => r.Date == d && r.Currency == currency && r.TenantSlug == tenant && r.Source == "Manual", ct);
            if (manual is not null) return (manual.Rate, d, "Manual");
            var cached = await db.FxRates.AsNoTracking().FirstOrDefaultAsync(r => r.Date == d && r.Currency == currency && r.TenantSlug == null, ct);
            if (cached is not null) return (cached.Rate, d, "TCMB");
            if (d.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday) continue;
            var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
            if (d > today) continue;
            var url = d == today ? $"{BaseUrl}/today.xml" : $"{BaseUrl}/{d:yyyyMM}/{d:ddMMyyyy}.xml";
            try
            {
                using var resp = await _http.GetAsync(url, ct);
                if (!resp.IsSuccessStatusCode) continue;
                var rates = Parse(await resp.Content.ReadAsStringAsync(ct));
                foreach (var (code, rate) in rates)
                    if (!await db.FxRates.AnyAsync(r => r.Date == d && r.Currency == code && r.TenantSlug == null, ct))
                        db.FxRates.Add(new FxRate { Date = d, Currency = code, Rate = rate, Source = "TCMB" });
                await db.SaveChangesAsync(ct);
                if (rates.TryGetValue(currency, out var hit)) return (hit, d, "TCMB");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning("TCMB kuru alınamadı ({Url}): {Message}", url, ex.Message);
                break;
            }
        }
        return null;
    }
}

/// <summary>Pasaport numarası için AES-256-GCM (TENANT_SECRET_KEY).</summary>
public static class SecretBox
{
    private static readonly byte[]? Key = Load();
    private static byte[]? Load()
    {
        var b64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY");
        if (string.IsNullOrWhiteSpace(b64)) return null;
        try { var k = Convert.FromBase64String(b64); return k.Length == 32 ? k : null; } catch (FormatException) { return null; }
    }
    public static bool Enabled => Key is not null;

    public static string Protect(string plain)
    {
        if (Key is null) throw new InvalidOperationException("TENANT_SECRET_KEY tanımlı değil");
        var nonce = RandomNumberGenerator.GetBytes(12);
        var bytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[bytes.Length];
        var tag = new byte[16];
        using var aes = new AesGcm(Key, 16);
        aes.Encrypt(nonce, bytes, cipher, tag);
        return "enc1:" + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public static string? Unprotect(string? stored)
    {
        if (stored is null || Key is null || !stored.StartsWith("enc1:")) return null;
        var data = Convert.FromBase64String(stored[5..]);
        var plain = new byte[data.Length - 28];
        using var aes = new AesGcm(Key, 16);
        aes.Decrypt(data.AsSpan(0, 12), data.AsSpan(28), data.AsSpan(12, 16), plain);
        return Encoding.UTF8.GetString(plain);
    }
}
