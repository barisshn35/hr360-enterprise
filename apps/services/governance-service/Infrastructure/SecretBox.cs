using System.Security.Cryptography;
using System.Text;

namespace GovernanceService.Infrastructure;

/// <summary>
/// Entegrasyon sirlarini (Slack bot jetonu, Teams uygulama parolasi, OAuth yenileme
/// jetonlari) veritabaninda duz metin tutmamak icin AES-256-GCM. Anahtar
/// tenant-service ile ayni TENANT_SECRET_KEY'dir (kalici, .env'de); bicim de
/// ayni: base64(nonce + tag + sifreli metin).
/// </summary>
public static class SecretBox
{
    private static byte[] Key()
    {
        var b64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY")
            ?? throw new InvalidOperationException("TENANT_SECRET_KEY tanımlı değil; entegrasyon sırları saklanamıyor.");
        var key = Convert.FromBase64String(b64);
        if (key.Length != 32) throw new InvalidOperationException("TENANT_SECRET_KEY 32 byte (base64) olmalı.");
        return key;
    }

    public static string? Protect(string? plain)
    {
        if (string.IsNullOrEmpty(plain)) return null;
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var bytes = Encoding.UTF8.GetBytes(plain);
        var cipher = new byte[bytes.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];
        using var aes = new AesGcm(Key(), tag.Length);
        aes.Encrypt(nonce, bytes, cipher, tag);
        return Convert.ToBase64String([.. nonce, .. tag, .. cipher]);
    }

    public static string? Unprotect(string? sealedValue)
    {
        if (string.IsNullOrEmpty(sealedValue)) return null;
        var data = Convert.FromBase64String(sealedValue);
        int n = AesGcm.NonceByteSizes.MaxSize, t = AesGcm.TagByteSizes.MaxSize;
        var plain = new byte[data.Length - n - t];
        using var aes = new AesGcm(Key(), t);
        aes.Decrypt(data[..n], data[(n + t)..], data[n..(n + t)], plain);
        return Encoding.UTF8.GetString(plain);
    }
}
