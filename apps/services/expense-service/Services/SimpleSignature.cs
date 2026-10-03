using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using ExpenseService.Models;

namespace ExpenseService.Services;

/// <summary>
/// Y28 basit elektronik imza - saf (birim testli) kurallar: OTP uretimi/ozeti/dogrulamasi,
/// dokuman ozeti, IP maskeleme ve kanit ozeti.
/// </summary>
public static class SimpleSignature
{
    public const int OtpDigits = 6;
    public static readonly TimeSpan OtpLifetime = TimeSpan.FromMinutes(10);
    public const int MaxAttempts = 5;
    /// <summary>Ayni talep icin kod en fazla bu kadar gonderilir (kaba kuvvete karsi).</summary>
    public const int MaxSends = 5;
    public static readonly TimeSpan ResendCooldown = TimeSpan.FromSeconds(30);

    public const string Disclaimer =
        "Basit elektronik imza — 5070 sayılı Kanun kapsamında nitelikli (güvenli) elektronik imza değildir.";

    public static string NewOtp() =>
        RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);

    private static readonly byte[] OtpKey = DeriveKey();

    private static byte[] DeriveKey()
    {
        var b64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY");
        byte[] seed;
        try { seed = string.IsNullOrWhiteSpace(b64) ? Encoding.UTF8.GetBytes("hr360-dev-otp") : Convert.FromBase64String(b64); }
        catch (FormatException) { seed = Encoding.UTF8.GetBytes(b64!); }
        // Anahtar ayrimi: sifreleme anahtari dogrudan kullanilmaz.
        return HMACSHA256.HashData(seed, Encoding.UTF8.GetBytes("hr360/expense/sign-otp/v1"));
    }

    /// <summary>OTP ozeti: HMAC-SHA256(anahtar, talepId:kod). Kod duz metin hicbir yerde saklanmaz.</summary>
    public static string HashOtp(Guid signatureId, string code) =>
        Convert.ToHexString(HMACSHA256.HashData(OtpKey, Encoding.UTF8.GetBytes($"{signatureId:N}:{code}"))).ToLowerInvariant();

    public enum OtpCheck { Ok, NoCode, Expired, TooManyAttempts, Wrong, BadFormat }

    /// <summary>Kodu dogrular; denemeyi sayma/kilitleme kararini cagiran uygular.</summary>
    public static OtpCheck Check(DocumentSignature s, string? code, DateTimeOffset now)
    {
        if (s.OtpHash is null || s.OtpExpiresAt is null) return OtpCheck.NoCode;
        if (s.OtpAttempts >= MaxAttempts) return OtpCheck.TooManyAttempts;
        if (now > s.OtpExpiresAt.Value) return OtpCheck.Expired;
        var c = (code ?? "").Trim();
        if (c.Length != OtpDigits || !c.All(char.IsAsciiDigit)) return OtpCheck.BadFormat;
        var given = Encoding.ASCII.GetBytes(HashOtp(s.Id, c));
        var expected = Encoding.ASCII.GetBytes(s.OtpHash);
        return CryptographicOperations.FixedTimeEquals(given, expected) ? OtpCheck.Ok : OtpCheck.Wrong;
    }

    public static string Sha256Hex(string s) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s))).ToLowerInvariant();

    /// <summary>
    /// Dokuman ozeti. Dosya baytlari bu serviste tutulmadigi icin (MinIO'da, StorageKey ile)
    /// ozet dokumanin kanonik ust verisini kapsar: kimlik, calisan, tur, ad, depolama anahtari,
    /// boyut, icerik turu ve yukleme zamani (ms). Bunlardan biri degisirse ozet degisir.
    /// </summary>
    public static string DocumentHash(Document d)
    {
        var canonical = string.Join("\n",
            "hr360-document-v1",
            d.Id.ToString("D"),
            d.EmployeeId.ToString("D"),
            d.Type.ToString(),
            d.FileName,
            d.StorageKey ?? "",
            d.SizeBytes.ToString(CultureInfo.InvariantCulture),
            d.ContentType ?? "",
            d.UploadedAt.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture));
        return Sha256Hex(canonical);
    }

    /// <summary>KVKK: IPv4'un son okteti, IPv6'nin /48 sonrasi sifirlanir. Gecersizse null.</summary>
    public static string? MaskIp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var first = raw.Split(',')[0].Trim();
        if (!IPAddress.TryParse(first, out var ip)) return null;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        var b = ip.GetAddressBytes();
        if (ip.AddressFamily == AddressFamily.InterNetwork)
            return $"{b[0]}.{b[1]}.{b[2]}.0";
        for (var i = 6; i < b.Length; i++) b[i] = 0;
        return new IPAddress(b).ToString();
    }

    public static string? HashUserAgent(string? ua) =>
        string.IsNullOrWhiteSpace(ua) ? null : Sha256Hex(ua.Trim());

    /// <summary>Kanit alanlarinin kanonik ozeti (butunluk kontrolu; kanit gosteriminde yeniden hesaplanir).</summary>
    public static string EvidenceHash(SignatureEvidence e) => Sha256Hex(string.Join("\n",
        "hr360-sign-evidence-v1",
        e.TenantSlug,
        e.SignatureId.ToString("D"),
        e.DocumentId.ToString("D"),
        e.SignerEmployeeId.ToString("D"),
        e.SignedAt.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture),
        e.DocumentHash,
        e.IpMasked ?? "",
        e.UserAgentHash ?? "",
        e.OtpChannel,
        e.Method));
}
