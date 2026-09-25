using System.Collections.Concurrent;
using System.Text.Json;
using NotificationService.Security;

namespace NotificationService.Services;

/// <summary>
/// tenant-service'in ANONIM "api/registration/branding/{slug}" ucundan
/// kiracinin logo URL'ini ve ana rengini ceker - e-posta bildirim
/// basliginda kiracinin KENDI logosunu gostermek icin kullanilir
/// (employee-service/OrganizationDirectoryClient ile ayni cross-service
/// HTTP client deseni, ama bu uc anonim oldugu icin JWT pass-through yok).
///
/// EmailSenderWorker her turda (30sn) ayni tenant icin defalarca cagirabilir
/// (bircok bekleyen bildirim ayni sirkete ait olabilir) - bu yuzden sonuc
/// kisa sureli (5 dk) process-ici bellekte tutulur. Bu, ayri instance'lar
/// arasinda paylasilmaz ama amac zaten agir bir cache degil, ayni turdaki
/// tekrarli cagrilari azaltmak.
/// </summary>
public class TenantBrandingClient
{
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(5);
    private static readonly ConcurrentDictionary<string, (DateTimeOffset ExpiresAt, TenantBranding? Value)> Cache = new();

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly SmtpCredentialProtector _protector;
    private readonly ILogger<TenantBrandingClient> _logger;

    public TenantBrandingClient(HttpClient http, SmtpCredentialProtector protector, ILogger<TenantBrandingClient> logger)
    {
        _http = http;
        _protector = protector;
        _logger = logger;
        _baseUrl = (Environment.GetEnvironmentVariable("TENANT_SERVICE_URL")
            ?? "http://172.33.55.2:5013").TrimEnd('/');
    }

    public record TenantBranding(string Name, string? LogoUrl, string? PrimaryColorHex);

    /// <summary>Cozulmus (plaintext) parolayla kiracinin ozel SMTP ayarlari.</summary>
    public record TenantSmtp(string Host, int Port, string? User, string Password, string? FromAddress, string? FromName);

    private record SmtpConfigDto(
        string SmtpHost, int? SmtpPort, string? SmtpUser, string? SmtpPasswordEncrypted,
        string? SmtpFromAddress, string? SmtpFromName);

    private static readonly ConcurrentDictionary<string, (DateTimeOffset ExpiresAt, TenantSmtp? Value)> SmtpCache = new();

    /// <summary>
    /// Marka bilgisini dondurur; bulunamazsa veya cross-service cagri
    /// basarisiz olursa null doner - bu SESSIZ bir best-effort islem,
    /// e-posta gonderimini asla engellememeli (varsayilan HR360 markasiyla
    /// gonderilir).
    /// </summary>
    public async Task<TenantBranding?> GetBrandingAsync(string tenantSlug, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tenantSlug)) return null;

        if (Cache.TryGetValue(tenantSlug, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
            return cached.Value;

        try
        {
            var resp = await _http.GetAsync($"{_baseUrl}/api/registration/branding/{tenantSlug}", ct);
            if (!resp.IsSuccessStatusCode)
            {
                Cache[tenantSlug] = (DateTimeOffset.UtcNow.Add(CacheTtl), null);
                return null;
            }

            var branding = JsonSerializer.Deserialize<TenantBranding>(
                await resp.Content.ReadAsStringAsync(ct), JsonOpts);
            Cache[tenantSlug] = (DateTimeOffset.UtcNow.Add(CacheTtl), branding);
            return branding;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Tenant marka bilgisi alinamadi ({Slug}), e-posta varsayilan HR360 markasiyla gonderilecek",
                tenantSlug);
            return null;
        }
    }

    /// <summary>
    /// Kiracinin OZEL SMTP sunucusu ayarlanmissa (Ayarlar > Marka'dan)
    /// cozulmus parolayla dondurur; ayarlanmamissa/bulunamazsa/cagri
    /// basarisiz olursa null doner - bu durumda EmailSenderWorker platform
    /// varsayilan SMTP'sine duser (best-effort, e-posta gonderimini
    /// engellememeli). tenant-service'ten SIFRELI gelen parola burada
    /// SmtpCredentialProtector ile cozulur (iki serviste de ayni
    /// TENANT_SECRET_KEY paylasilir).
    /// </summary>
    public async Task<TenantSmtp?> GetSmtpConfigAsync(string tenantSlug, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(tenantSlug)) return null;

        if (SmtpCache.TryGetValue(tenantSlug, out var cached) && cached.ExpiresAt > DateTimeOffset.UtcNow)
            return cached.Value;

        try
        {
            var resp = await _http.GetAsync($"{_baseUrl}/internal/smtp-config/{tenantSlug}", ct);
            if (!resp.IsSuccessStatusCode)
            {
                // 404: ozel SMTP ayarlanmamis - bu bir hata degil, cok yaygin
                // bir durum (kiracilarin cogu platform varsayilanini kullanir).
                SmtpCache[tenantSlug] = (DateTimeOffset.UtcNow.Add(CacheTtl), null);
                return null;
            }

            var dto = JsonSerializer.Deserialize<SmtpConfigDto>(
                await resp.Content.ReadAsStringAsync(ct), JsonOpts);
            if (dto is null || string.IsNullOrEmpty(dto.SmtpPasswordEncrypted))
            {
                SmtpCache[tenantSlug] = (DateTimeOffset.UtcNow.Add(CacheTtl), null);
                return null;
            }

            var smtp = new TenantSmtp(
                Host: dto.SmtpHost,
                Port: dto.SmtpPort ?? 587,
                User: dto.SmtpUser,
                Password: _protector.Decrypt(dto.SmtpPasswordEncrypted),
                FromAddress: dto.SmtpFromAddress,
                FromName: dto.SmtpFromName);

            SmtpCache[tenantSlug] = (DateTimeOffset.UtcNow.Add(CacheTtl), smtp);
            return smtp;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Tenant ozel SMTP ayarlari alinamadi/cozulemedi ({Slug}), platform varsayilan SMTP'si kullanilacak",
                tenantSlug);
            return null;
        }
    }
}
