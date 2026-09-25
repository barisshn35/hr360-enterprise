using System.Security.Cryptography;

namespace NotificationService.Security;

/// <summary>
/// tenant-service/Security/SmtpCredentialProtector.cs ile BIREBIR AYNI -
/// kiracinin AES-256-GCM ile sifrelenmis SMTP parolasini cozmek icin
/// burada da bulunmasi gerekiyor (iki servis de ayni TENANT_SECRET_KEY
/// ortam degiskenini paylasir). Kod tekrari bilincli: bu monorepo'da
/// servisler arasinda paylasilan bir ortak kutuphane yok (her servis
/// kendi Dockerfile'iyla bagimsiz build edilir), o yuzden kucuk,
/// bagimsiz sinifları kopyalamak, cross-service paket bagimliligi
/// eklemekten daha basit ve servisleri birbirinden ayri tutuyor.
/// </summary>
public class SmtpCredentialProtector
{
    private readonly byte[] _key;

    public SmtpCredentialProtector()
    {
        var keyBase64 = Environment.GetEnvironmentVariable("TENANT_SECRET_KEY")
            ?? throw new InvalidOperationException("TENANT_SECRET_KEY tanimli olmali");
        _key = Convert.FromBase64String(keyBase64);
        if (_key.Length != 32)
            throw new InvalidOperationException("TENANT_SECRET_KEY 32 byte (base64) olmali");
    }

    public string Decrypt(string encryptedBase64)
    {
        var data = Convert.FromBase64String(encryptedBase64);
        var nonceSize = AesGcm.NonceByteSizes.MaxSize;
        var tagSize = AesGcm.TagByteSizes.MaxSize;

        var nonce = data[..nonceSize];
        var tag = data[nonceSize..(nonceSize + tagSize)];
        var cipherBytes = data[(nonceSize + tagSize)..];
        var plainBytes = new byte[cipherBytes.Length];

        using var aes = new AesGcm(_key, tagSize);
        aes.Decrypt(nonce, cipherBytes, tag, plainBytes);
        return System.Text.Encoding.UTF8.GetString(plainBytes);
    }
}
