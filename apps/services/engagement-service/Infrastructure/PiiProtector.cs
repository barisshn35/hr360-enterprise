using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using EngagementService.Data;

namespace EngagementService.Infrastructure;

/// <summary>
/// KVKK m.12 (veri güvenliği): TCKN ve IBAN veritabanında AES-256-GCM ile şifreli tutulur.
/// Biçim: "enc1:" + base64(nonce + tag + şifreli metin). Anahtar TENANT_SECRET_KEY
/// (governance ve tenant-service ile aynı). Önekli olmayan değerler eski düz metindir;
/// okunurken olduğu gibi döner, açılışta <see cref="PiiBackfill"/> bunları şifreler.
/// </summary>
public static class PiiProtector
{
    public const string Prefix = "enc1:";
    private static readonly byte[]? Key = LoadKey();

    public static bool Enabled => Key is not null;

    private static byte[]? LoadKey()
    {
        var b64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY");
        if (string.IsNullOrWhiteSpace(b64)) return null;
        try
        {
            var k = Convert.FromBase64String(b64);
            return k.Length == 32 ? k : null;
        }
        catch (FormatException) { return null; }
    }

    public static string? Protect(string? plain)
    {
        if (string.IsNullOrEmpty(plain) || plain.StartsWith(Prefix, StringComparison.Ordinal) || Key is null) return plain;
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var bytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[bytes.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        using var aes = new AesGcm(Key, tag.Length);
        aes.Encrypt(nonce, bytes, cipher, tag);
        return Prefix + Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public static string? Unprotect(string? stored)
    {
        if (string.IsNullOrEmpty(stored) || !stored.StartsWith(Prefix, StringComparison.Ordinal)) return stored;
        if (Key is null) throw new InvalidOperationException("TENANT_SECRET_KEY tanımlı değil; şifreli kişisel veri açılamıyor.");
        var data = Convert.FromBase64String(stored[Prefix.Length..]);
        int n = AesGcm.NonceByteSizes.MaxSize, t = AesGcm.TagByteSizes.MaxSize;
        var plain = new byte[data.Length - n - t];
        using var aes = new AesGcm(Key, t);
        aes.Decrypt(data.AsSpan(0, n), data.AsSpan(n + t), data.AsSpan(n, t), plain);
        return Encoding.UTF8.GetString(plain);
    }

    public static readonly ValueConverter<string?, string?> Converter =
        new(v => Protect(v), v => Unprotect(v));
}

/// <summary>Açılışta düz metin kalmış TCKN/IBAN değerlerini şifreler (bir kez, idempotent).</summary>
public sealed class PiiBackfill(IServiceProvider sp, ILogger<PiiBackfill> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        if (!PiiProtector.Enabled)
        {
            log.LogWarning("TENANT_SECRET_KEY yok: TCKN ve IBAN veritabanında ŞİFRESİZ saklanıyor (KVKK m.12). .env'e ekleyin.");
            return;
        }
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), ct);
            var sql = sp.GetRequiredService<Sql>();
            var ids = await sql.QueryAsync("""
                SELECT "Id" FROM engagement_profiles
                WHERE ("Iban" IS NOT NULL AND "Iban" <> '' AND "Iban" NOT LIKE 'enc1:%')
                   OR ("NationalId" IS NOT NULL AND "NationalId" <> '' AND "NationalId" NOT LIKE 'enc1:%')
                """, r => r.GetGuid(0), ct);
            if (ids.Count == 0) return;
            foreach (var id in ids)
            {
                var row = (await sql.QueryAsync("""SELECT "Iban", "NationalId" FROM engagement_profiles WHERE "Id" = $1""",
                    r => (Iban: r.IsDBNull(0) ? null : r.GetString(0), Nid: r.IsDBNull(1) ? null : r.GetString(1)), ct, id)).First();
                await sql.ExecuteAsync("""UPDATE engagement_profiles SET "Iban" = $2, "NationalId" = $3 WHERE "Id" = $1""",
                    ct, id, (object?)PiiProtector.Protect(row.Iban) ?? DBNull.Value, (object?)PiiProtector.Protect(row.Nid) ?? DBNull.Value);
            }
            log.LogInformation("{Count} profilde TCKN/IBAN şifrelendi.", ids.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "TCKN/IBAN şifreleme turu başarısız; bir sonraki açılışta tekrar denenecek.");
        }
    }
}
