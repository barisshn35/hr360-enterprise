using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using GovernanceService.Tenancy;

namespace GovernanceService.Infrastructure;

/// <summary>
/// Y28 basit elektronik imza (tek kullanımlık kod). Kod 6 hanelidir, 10 dakika geçerlidir,
/// en fazla 5 deneme yapılabilir ve veritabanında yalnızca HMAC-SHA256 özeti tutulur.
/// Başarılı imzada belge içeriğinin SHA-256'sı, imzalayan, zaman, yöntem ve /24'e kısaltılmış
/// IP ile kanıt kaydı oluşur. 5070 sayılı Kanun kapsamında güvenli/nitelikli e-imza DEĞİLDİR.
/// </summary>
public static class Signatures
{
    public const int ValidMinutes = 10;
    public const int MaxAttempts = 5;
    public const string DisclaimerTr = "Basit elektronik imza — 5070 sayılı Kanun kapsamında güvenli/nitelikli elektronik imza değildir";
    public const string DisclaimerEn = "Simple electronic signature — not a secure/qualified electronic signature under Turkish Law No. 5070";

    public static string NewCode() => RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6");

    private static byte[] Key()
    {
        var b64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY");
        var seed = string.IsNullOrEmpty(b64) ? Encoding.UTF8.GetBytes("hr360-otp-dev") : Convert.FromBase64String(b64);
        // Anahtar ayrımı: şifreleme anahtarı doğrudan HMAC'te kullanılmaz.
        return HMACSHA256.HashData(seed, Encoding.UTF8.GetBytes("hr360/otp/v1"));
    }

    /// <summary>Kodun özeti; kayıt kimliği tuz görevi görür (aynı kod farklı özet üretir).</summary>
    public static string Hash(Guid otpId, string code) =>
        Convert.ToHexString(HMACSHA256.HashData(Key(), Encoding.UTF8.GetBytes($"{otpId:N}:{code.Trim()}"))).ToLowerInvariant();

    public static bool Matches(Guid otpId, string code, string storedHash) =>
        CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(Hash(otpId, code)), Encoding.UTF8.GetBytes(storedHash));

    /// <summary>Kod durumu: ok | consumed | expired | locked.</summary>
    public static string State(DateTime expiresAt, int attempts, DateTime? consumedAt, DateTime now) =>
        consumedAt is not null ? "consumed" : now > expiresAt ? "expired" : attempts >= MaxAttempts ? "locked" : "ok";

    /// <summary>IP'yi kısaltır: IPv4 /24 (a.b.c.0/24), IPv6 /48. Çözülemeyen değer null.</summary>
    public static string? TruncateIp(string? ip)
    {
        if (string.IsNullOrWhiteSpace(ip)) return null;
        var first = ip.Split(',')[0].Trim();
        if (!IPAddress.TryParse(first, out var a)) return null;
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        var b = a.GetAddressBytes();
        if (a.AddressFamily == AddressFamily.InterNetwork) return $"{b[0]}.{b[1]}.{b[2]}.0/24";
        for (var i = 6; i < 16; i++) b[i] = 0;
        return $"{new IPAddress(b)}/48";
    }

    public static string Sha256Hex(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();

    /// <summary>Kanıtın kanonik metni (alan sırası sabit) — kanıt özeti bunun SHA-256'sıdır.</summary>
    public static string Canonical(string documentType, Guid documentId, int version, string documentSha256, Guid signer, DateTime signedAtUtc, string method, string? ipPrefix) =>
        JsonSerializer.Serialize(new object?[]
        {
            "hr360-ses-v1", documentType, documentId.ToString(), version, documentSha256, signer.ToString(),
            signedAtUtc.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), method, ipPrefix, DisclaimerTr,
        });
}

/// <summary>
/// Governance içinde doğan olaylar (ör. document.signed): governance_events'e yazılır,
/// radara yayınlanır ve kural/webhook/REST hook dağıtıcısına verilir (arka planda).
/// </summary>
public static class InternalEvents
{
    public static void Raise(IServiceProvider sp, string tenant, string type, object payload)
    {
        var factory = sp.GetRequiredService<IServiceScopeFactory>();
        var hub = sp.GetRequiredService<EventHub>();
        var log = sp.GetRequiredService<ILogger<EventHub>>();
        var json = JsonSerializer.Serialize(payload);
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = factory.CreateScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().IsPlatformAdmin = true;
                var sql = scope.ServiceProvider.GetRequiredService<Sql>();
                var id = Guid.NewGuid();
                var at = DateTime.UtcNow;
                await sql.ExecuteAsync("""
                    INSERT INTO governance_events ("Id","TenantSlug","Topic","EventType","Payload","OccurredAt")
                    VALUES ($1,$2,'governance.internal',$3,$4::jsonb,$5) ON CONFLICT ("Id") DO NOTHING
                    """, CancellationToken.None, id, tenant, type, json, at);
                var el = JsonDocument.Parse(json).RootElement.Clone();
                hub.Publish(new RadarEvent(id, tenant, "governance.internal", type, el, at, EventHub.Describe(type, el)));
                await scope.ServiceProvider.GetRequiredService<Dispatcher>().DispatchAsync(scope.ServiceProvider, tenant, id, type, el, CancellationToken.None);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "İç olay dağıtılamadı ({Type})", type);
            }
        });
    }
}
