using System.Security.Cryptography;

namespace TenantService.Security;

/// <summary>
/// Tenant'in kendi SMTP sifresini DB'de duz metin TUTMAMAK icin AES-256-GCM
/// ile sifreler/cozer.
///
/// KRITIK: ASP.NET Core Data Protection API BILEREK KULLANILMADI - o
/// anahtarlarini container'in kendi (ephemeral) dosya sistemine yazar,
/// her "docker compose" yeniden olusturmasinda (yani HER DEPLOY'DA)
/// anahtarlar kaybolur ve onceden sifrelenmis veriler COZULEMEZ hale
/// gelir. Burada TENANT_SECRET_KEY sabit bir ortam degiskeninden
/// okunuyor - deploy'lar arasi AYNI KEY kullanildigi icin kalici.
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

    public string Encrypt(string plainText)
    {
        var nonce = RandomNumberGenerator.GetBytes(AesGcm.NonceByteSizes.MaxSize);
        var plainBytes = System.Text.Encoding.UTF8.GetBytes(plainText);
        var cipherBytes = new byte[plainBytes.Length];
        var tag = new byte[AesGcm.TagByteSizes.MaxSize];

        using var aes = new AesGcm(_key, tag.Length);
        aes.Encrypt(nonce, plainBytes, cipherBytes, tag);

        // nonce + tag + ciphertext, tek base64 string olarak sakla.
        var result = new byte[nonce.Length + tag.Length + cipherBytes.Length];
        Buffer.BlockCopy(nonce, 0, result, 0, nonce.Length);
        Buffer.BlockCopy(tag, 0, result, nonce.Length, tag.Length);
        Buffer.BlockCopy(cipherBytes, 0, result, nonce.Length + tag.Length, cipherBytes.Length);
        return Convert.ToBase64String(result);
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
