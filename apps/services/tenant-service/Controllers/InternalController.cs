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

    public InternalController(TenantDbContext db)
    {
        _db = db;
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
