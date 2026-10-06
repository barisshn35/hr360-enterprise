using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;

namespace TenantService.Controllers;

/// <summary>
/// Servisler-arasi (service-to-service) uclar - "/api/" altinda DEGIL bilerek:
/// deploy/nginx/nginx.conf'ta "/internal/" icin hicbir location tanimli
/// degil, dolayisiyla bu uclar gateway (internet) uzerinden ERISILEMEZ,
/// sadece Docker'in ic agindaki diger container'lar TENANT_SERVICE_URL ile
/// dogrudan cagirabilir. "/api/registration/branding/{slug}" (herkese acik
/// logo/renk) ile KARISTIRILMASIN - o bilincli olarak internetten de
/// erisilebilir, bu controller'daki uclar ise SADECE ic ag icindir ve bu
/// yuzden SMTP sifresi gibi daha hassas alanlari (sifreli halde) donebilir.
/// </summary>
[ApiController]
[Route("internal")]
[AllowAnonymous]
public class InternalController : ControllerBase
{
    private readonly TenantDbContext _db;
    private readonly TenantService.Services.KeycloakAdminClient _keycloak;
    private readonly ILogger<InternalController> _log;

    public InternalController(TenantDbContext db, TenantService.Services.KeycloakAdminClient keycloak, ILogger<InternalController> log)
    {
        _db = db;
        _keycloak = keycloak;
        _log = log;
    }

    /// <summary>X-Internal-Token (INTERNAL_SERVICE_TOKEN) sabit zamanli karsilastirma; tanimsizsa uc kapali.</summary>
    private bool InternalTokenValid() =>
        Security.InternalServiceToken.Matches(Request.Headers[Security.InternalServiceToken.Header].FirstOrDefault());

    public record DisableUserRequest(string TenantSlug, string KeycloakUserId, string? Reason);

    /// <summary>
    /// Dalga 5c (G15): isten ayrilan calisanin hesabini kapatir ve TUM oturumlarini sonlandirir
    /// (engagement-service offboarding tamamlanirken cagirir). Hedef, cagiran kiracinin Keycloak
    /// organizasyonunun uyesi olmali; degilse 404 (baska kiracinin hesabi kapatilamaz). Sirket
    /// yoneticisi (kiracinin kurucu yonetici hesabi) ve platform yoneticileri bu yolla kapatilamaz.
    ///
    /// NOT: Kapatma, kullanicinin TAM temsiliyle yapilir (SuspendUserForTenantAsync) - yalnizca
    /// {enabled:false} gondermek (SetUserEnabledAsync) Keycloak 25'te e-posta/ad niteliklerini siliyor.
    /// </summary>
    [HttpPost("users/disable")]
    public async Task<IActionResult> DisableUser([FromBody] DisableUserRequest request, CancellationToken ct)
    {
        if (!InternalTokenValid()) return NotFound();
        if (string.IsNullOrWhiteSpace(request.TenantSlug) || string.IsNullOrWhiteSpace(request.KeycloakUserId))
            return BadRequest(new { message = "Kiracı ve kullanıcı kimliği zorunlu" });
        if (!Guid.TryParse(request.KeycloakUserId, out _))
            return BadRequest(new { message = "Geçersiz kullanıcı kimliği" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == request.TenantSlug.ToLowerInvariant(), ct);
        if (tenant?.KeycloakOrgId is null) return NotFound(new { message = "Şirket bulunamadı" });
        if (!await _keycloak.IsOrganizationMemberAsync(tenant.KeycloakOrgId, request.KeycloakUserId, ct))
            return NotFound(new { message = "Kullanıcı bu şirkette bulunamadı" });
        if (string.Equals(tenant.AdminUserId, request.KeycloakUserId, StringComparison.OrdinalIgnoreCase))
            return Conflict(new { message = "Şirketin kurucu yönetici hesabı bu yolla kapatılamaz" });
        var roles = await _keycloak.GetUserRealmRolesAsync(request.KeycloakUserId, ct);
        if (roles.Contains("platform-admin"))
            return Conflict(new { message = "Platform yöneticisi hesabı bu yolla kapatılamaz" });

        var disabledNow = await _keycloak.SuspendUserForTenantAsync(request.KeycloakUserId, ct);
        _log.LogInformation("Ayrilan calisan hesabi kapatildi: kiraci {Tenant}, kullanici {User}, yeni kapatildi={Now}",
            tenant.Slug, request.KeycloakUserId, disabledNow);
        return Ok(new { disabled = true, alreadyDisabled = !disabledNow, sessionsEnded = true });
    }

    /// <summary>
    /// Kiracinin kendi SMTP sunucusu ayarlanmissa (Ayarlar > Marka, sadece
    /// Enterprise) dondurur - notification-service bunu EmailSenderWorker'da
    /// kullanir. Sifre SIFRELI (SmtpPasswordEncrypted) doner; cozme islemi
    /// notification-service tarafinda, ayni TENANT_SECRET_KEY paylasilarak
    /// yapilir (bkz. SmtpCredentialProtector, iki serviste de birebir ayni).
    /// Kiracinin ozel SMTP'si yoksa 404 doner - cagiran platform
    /// varsayilanina duser.
    /// </summary>
    [HttpGet("smtp-config/{slug}")]
    public async Task<IActionResult> SmtpConfig(string slug)
    {
        if (string.IsNullOrWhiteSpace(slug))
            return BadRequest(new { message = "Slug bos olamaz" });

        var tenant = await _db.Tenants
            .Where(t => t.Slug == slug.ToLowerInvariant() && t.SmtpHost != null)
            .Select(t => new
            {
                t.SmtpHost,
                t.SmtpPort,
                t.SmtpUser,
                t.SmtpPasswordEncrypted,
                t.SmtpFromAddress,
                t.SmtpFromName,
            })
            .FirstOrDefaultAsync();

        return tenant is null ? NotFound() : Ok(tenant);
    }
}
