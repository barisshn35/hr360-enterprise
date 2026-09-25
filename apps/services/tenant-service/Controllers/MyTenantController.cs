using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;
using TenantService.Models;
using TenantService.Security;
using TenantService.Services;

namespace TenantService.Controllers;

/// <summary>
/// Oturum acan kullanicinin kendi tenant bilgisi. Frontend acilista bunu
/// cagirip sirket adini, planini ve kotasini gosterir.
/// </summary>
[ApiController]
[Route("api/my-tenant")]
[Authorize]
public class MyTenantController : ControllerBase
{
    private readonly TenantDbContext _db;
    private readonly SmtpCredentialProtector _protector;
    private readonly LogoStorageService _logos;
    public MyTenantController(TenantDbContext db, SmtpCredentialProtector protector, LogoStorageService logos)
    {
        _db = db;
        _protector = protector;
        _logos = logos;
    }

    [HttpGet]
    public async Task<IActionResult> Get()
    {
        // organization claim'i Keycloak tarafindan JWT'ye eklenir; degeri
        // tenant slug'idir. Claim yoksa kullanici hicbir tenant'a bagli degildir.
        var slug = User.FindFirst("organization")?.Value;

        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        // Claim dizi olarak gelebilir: ["acme"] -> acme
        slug = slug.Trim('[', ']', '"', ' ');

        var tenant = await _db.Tenants
            .Where(t => t.Slug == slug)
            .Select(t => new
            {
                t.Id, t.Name, t.Slug, t.Status, t.Plan, t.MaxEmployees, t.CreatedAt,
                t.LogoUrl, t.PrimaryColorHex,
                // SMTP sifresi ASLA donmez - sadece "ayarlanmis mi" bilgisi.
                HasCustomSmtp = t.SmtpHost != null,
                t.SmtpFromAddress, t.SmtpFromName,
            })
            .FirstOrDefaultAsync();

        return tenant is null
            ? NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" })
            : Ok(tenant);
    }

    /// <summary>
    /// Beyaz etiketleme ayarlari (sirket adi degisikligi haric - o ayri,
    /// dogrulama gerektirmeyen bir alan). SADECE Enterprise plan.
    /// LogoUrl buradan degil, ayri bir dosya yukleme ucundan set edilir.
    /// </summary>
    public record UpdateBrandingRequest(
        string? SmtpHost, int? SmtpPort, string? SmtpUser, string? SmtpPassword,
        string? SmtpFromAddress, string? SmtpFromName, string? PrimaryColorHex);

    private static readonly System.Text.RegularExpressions.Regex HexColorPattern =
        new(@"^#[0-9A-Fa-f]{6}$");

    [HttpPut("branding")]
    [Authorize(Policy = "RequireTenantAdmin")]
    public async Task<IActionResult> UpdateBranding([FromBody] UpdateBrandingRequest request)
    {
        var slug = User.FindFirst("organization")?.Value?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tenant is null)
            return NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" });

        if (tenant.Plan != TenantPlan.Enterprise)
            return Forbid();

        // Kismi guncelleme: PrimaryColorHex gonderilmemisse mevcut ayar
        // korunur. Bos string ("") gonderilirse renk KALDIRILIR
        // (platformun varsayilan zumrut rengine donulur).
        if (request.PrimaryColorHex is not null)
        {
            if (request.PrimaryColorHex.Length == 0)
            {
                tenant.PrimaryColorHex = null;
            }
            else if (!HexColorPattern.IsMatch(request.PrimaryColorHex))
            {
                return BadRequest(new { message = "Renk '#c0392b' formatinda 6 haneli hex olmali" });
            }
            else
            {
                tenant.PrimaryColorHex = request.PrimaryColorHex;
            }
        }

        // Kismi guncelleme: SmtpHost gonderilmemisse (null) mevcut ayar
        // korunur. Bos string ("") gonderilirse ozel SMTP KALDIRILIR
        // (platformun varsayilan gonderim borusuna donulur).
        if (request.SmtpHost is not null)
        {
            if (request.SmtpHost.Length == 0)
            {
                tenant.SmtpHost = null;
                tenant.SmtpPort = null;
                tenant.SmtpUser = null;
                tenant.SmtpPasswordEncrypted = null;
                tenant.SmtpFromAddress = null;
                tenant.SmtpFromName = null;
            }
            else
            {
                tenant.SmtpHost = request.SmtpHost;
                tenant.SmtpPort = request.SmtpPort ?? 587;
                tenant.SmtpUser = request.SmtpUser;
                if (!string.IsNullOrEmpty(request.SmtpPassword))
                    tenant.SmtpPasswordEncrypted = _protector.Encrypt(request.SmtpPassword);
                tenant.SmtpFromAddress = request.SmtpFromAddress;
                tenant.SmtpFromName = request.SmtpFromName;
            }
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            message = "Marka ayarları güncellendi",
            hasCustomSmtp = tenant.SmtpHost != null,
            primaryColorHex = tenant.PrimaryColorHex,
        });
    }

    public record RenameRequest(string Name);

    [HttpPut("name")]
    [Authorize(Policy = "RequireTenantAdmin")]
    public async Task<IActionResult> Rename([FromBody] RenameRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200)
            return BadRequest(new { message = "Şirket adı 1-200 karakter olmalı" });

        var slug = User.FindFirst("organization")?.Value?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tenant is null)
            return NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" });

        // Sirket adi degistirme TUM planlarda acik - beyaz etiketleme
        // (logo/SMTP) SADECE Enterprise, ama isim degisikligi degil.
        tenant.Name = request.Name.Trim();
        await _db.SaveChangesAsync();
        return Ok(new { message = "Şirket adı güncellendi", name = tenant.Name });
    }

    /// <summary>
    /// Logo yukler (SADECE Enterprise). multipart/form-data ile tek dosya
    /// bekler - form alan adi "file". Basariliysa yeni URL'i doner ve
    /// Tenant.LogoUrl'i gunceller.
    /// </summary>
    [HttpPost("logo")]
    [Authorize(Policy = "RequireTenantAdmin")]
    [RequestSizeLimit(2 * 1024 * 1024 + 1024)] // 2MB dosya + kucuk form-data payi
    public async Task<IActionResult> UploadLogo(IFormFile? file, CancellationToken ct)
    {
        var slug = User.FindFirst("organization")?.Value?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tenant is null)
            return NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" });

        if (tenant.Plan != TenantPlan.Enterprise)
            return Forbid();

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Dosya bulunamadı" });

        await using var stream = file.OpenReadStream();
        var result = await _logos.UploadAsync(tenant.Id, file.ContentType, stream, file.Length, ct);
        if (!result.Success)
            return BadRequest(new { message = result.Error });

        tenant.LogoUrl = result.Url;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Logo yüklendi", logoUrl = tenant.LogoUrl });
    }

    [HttpDelete("logo")]
    [Authorize(Policy = "RequireTenantAdmin")]
    public async Task<IActionResult> DeleteLogo(CancellationToken ct)
    {
        var slug = User.FindFirst("organization")?.Value?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tenant is null)
            return NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" });

        if (tenant.Plan != TenantPlan.Enterprise)
            return Forbid();

        await _logos.DeleteAsync(tenant.Id, ct);
        tenant.LogoUrl = null;
        await _db.SaveChangesAsync();
        return Ok(new { message = "Logo kaldırıldı" });
    }
}
