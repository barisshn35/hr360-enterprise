using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace TenantService.Services;

/// <summary>
/// Tenant logolarini MinIO'ya (S3-uyumlu) yukler. Her tenant'in tek bir
/// logo dosyasi vardir, tenant.Id ile adlandirilir - yeni yukleme ESKISININ
/// UZERINE YAZAR (bucket'ta biriken eski dosya kalmaz).
///
/// Yuklenen dosya, gateway'in "/logos/" yolundan (nginx, dogrudan MinIO'ya
/// proxy) HERKESE ACIK okunur - kimlik dogrulama gerektirmez, cunku logo
/// giris ekraninda (henuz oturum acilmadan) da gosterilir.
/// </summary>
public class LogoStorageService
{
    private const string BucketName = "tenant-logos";
    private const long MaxFileSizeBytes = 2 * 1024 * 1024; // 2 MB

    /// <summary>
    /// GUVENLIK: SVG artik KABUL EDILMIYOR. SVG betik (script) tasiyabilir ve logolar
    /// uygulamanin KENDI alan adindan (/logos/) sunuluyor - bir kiracinin yukledigi
    /// SVG, baglantiyi acan herkesin (baska kiracilarin kullanicilari, platform
    /// yoneticisi) oturumunda ayni kaynakta calisip Keycloak oturumundan jeton
    /// alabiliyordu. Ayrica tur, istemcinin gonderdigi ContentType'a degil dosyanin
    /// ilk baytlarina (magic bytes) bakilarak belirlenir.
    /// </summary>
    private static readonly Dictionary<string, string> AllowedContentTypes = new()
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/webp"] = "webp",
    };

    /// <summary>Eski yuklemelerin temizligi icin (onceden svg kabul ediliyordu).</summary>
    private static readonly string[] AllKnownExtensions = { "png", "jpg", "webp", "svg" };

    private static string? DetectImageType(ReadOnlySpan<byte> h)
    {
        if (h.Length >= 8 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47
            && h[4] == 0x0D && h[5] == 0x0A && h[6] == 0x1A && h[7] == 0x0A) return "image/png";
        if (h.Length >= 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF) return "image/jpeg";
        if (h.Length >= 12 && h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F'
            && h[8] == 'W' && h[9] == 'E' && h[10] == 'B' && h[11] == 'P') return "image/webp";
        return null;
    }

    private readonly AmazonS3Client _client;
    private readonly string _publicBaseUrl;

    public LogoStorageService()
    {
        var endpoint = Environment.GetEnvironmentVariable("MINIO_ENDPOINT_URL")
            ?? "http://172.33.55.5:9000";
        var accessKey = Environment.GetEnvironmentVariable("MINIO_ACCESS_KEY")
            ?? throw new InvalidOperationException("MINIO_ACCESS_KEY tanimli olmali");
        var secretKey = Environment.GetEnvironmentVariable("MINIO_SECRET_KEY")
            ?? throw new InvalidOperationException("MINIO_SECRET_KEY tanimli olmali");
        _publicBaseUrl = (Environment.GetEnvironmentVariable("LOGO_PUBLIC_BASE_URL")
            ?? "https://hr360.local/logos").TrimEnd('/');

        _client = new AmazonS3Client(
            new BasicAWSCredentials(accessKey, secretKey),
            new AmazonS3Config
            {
                ServiceURL = endpoint,
                ForcePathStyle = true, // MinIO virtual-hosted stili desteklemez.
                UseHttp = endpoint.StartsWith("http://"),
            });
    }

    public record UploadResult(bool Success, string? Url, string? Error);

    public async Task<UploadResult> UploadAsync(
        Guid tenantId, string contentType, Stream fileStream, long fileSizeBytes, CancellationToken ct)
    {
        if (fileSizeBytes > MaxFileSizeBytes)
            return new UploadResult(false, null, "Dosya en fazla 2 MB olabilir");

        // Dosyayi bellege al (en fazla 2 MB) ve turunu iceriginden tespit et.
        using var buffer = new MemoryStream();
        await fileStream.CopyToAsync(buffer, ct);
        if (buffer.Length > MaxFileSizeBytes)
            return new UploadResult(false, null, "Dosya en fazla 2 MB olabilir");
        var detected = DetectImageType(buffer.GetBuffer().AsSpan(0, (int)Math.Min(buffer.Length, 16)));
        if (detected is null || !AllowedContentTypes.TryGetValue(detected, out var extension))
            return new UploadResult(false, null, "Sadece PNG, JPEG veya WebP kabul edilir");
        contentType = detected;
        buffer.Position = 0;

        var key = $"{tenantId}.{extension}";

        // Ayni tenant icin ONCEDEN farkli bir uzantiyla yuklenmis logo
        // varsa (ornek: once .png, simdi .svg) o eski dosyayi da temizle -
        // yoksa iki dosya birikir ve hangisinin "guncel" oldugu belirsizlesir.
        foreach (var oldExt in AllKnownExtensions)
        {
            if (oldExt == extension) continue;
            try
            {
                await _client.DeleteObjectAsync(BucketName, $"{tenantId}.{oldExt}", ct);
            }
            catch (AmazonS3Exception)
            {
                // Dosya yoksa MinIO hata vermez ama olur da baska bir sorun
                // cikarsa yuklemeyi engellememeli.
            }
        }

        try
        {
            await _client.PutObjectAsync(new PutObjectRequest
            {
                BucketName = BucketName,
                Key = key,
                InputStream = buffer,
                ContentType = contentType,
                AutoCloseStream = false,
            }, ct);
        }
        catch (Exception ex)
        {
            // Ic hata ayrintisi (MinIO adresi vb.) istemciye sizdirilmaz.
            Console.Error.WriteLine($"Logo yukleme hatasi: {ex}");
            return new UploadResult(false, null, "Yükleme başarısız, lütfen tekrar deneyin");
        }

        // Cache-busting: ayni dosya adiyla ustune yazildiginda tarayicinin
        // eski logoyu cache'den gostermemesi icin URL'e zaman damgasi eklenir.
        var url = $"{_publicBaseUrl}/{key}?v={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
        return new UploadResult(true, url, null);
    }

    public async Task DeleteAsync(Guid tenantId, CancellationToken ct)
    {
        foreach (var ext in AllKnownExtensions)
        {
            try
            {
                await _client.DeleteObjectAsync(BucketName, $"{tenantId}.{ext}", ct);
            }
            catch (AmazonS3Exception)
            {
                // Dosya yoksa sorun degil.
            }
        }
    }
}
