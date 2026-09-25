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

    private static readonly Dictionary<string, string> AllowedContentTypes = new()
    {
        ["image/png"] = "png",
        ["image/jpeg"] = "jpg",
        ["image/svg+xml"] = "svg",
        ["image/webp"] = "webp",
    };

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
            ?? "https://staffware.com.tr/logos").TrimEnd('/');

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
        if (!AllowedContentTypes.TryGetValue(contentType, out var extension))
            return new UploadResult(false, null, "Sadece PNG, JPEG, SVG veya WebP kabul edilir");

        if (fileSizeBytes > MaxFileSizeBytes)
            return new UploadResult(false, null, "Dosya en fazla 2 MB olabilir");

        var key = $"{tenantId}.{extension}";

        // Ayni tenant icin ONCEDEN farkli bir uzantiyla yuklenmis logo
        // varsa (ornek: once .png, simdi .svg) o eski dosyayi da temizle -
        // yoksa iki dosya birikir ve hangisinin "guncel" oldugu belirsizlesir.
        foreach (var oldExt in AllowedContentTypes.Values)
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
                InputStream = fileStream,
                ContentType = contentType,
                AutoCloseStream = false,
            }, ct);
        }
        catch (Exception ex)
        {
            return new UploadResult(false, null, $"Yükleme başarısız: {ex.Message}");
        }

        // Cache-busting: ayni dosya adiyla ustune yazildiginda tarayicinin
        // eski logoyu cache'den gostermemesi icin URL'e zaman damgasi eklenir.
        var url = $"{_publicBaseUrl}/{key}?v={DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
        return new UploadResult(true, url, null);
    }

    public async Task DeleteAsync(Guid tenantId, CancellationToken ct)
    {
        foreach (var ext in AllowedContentTypes.Values)
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
