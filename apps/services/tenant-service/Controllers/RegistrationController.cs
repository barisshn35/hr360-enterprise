using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;
using TenantService.Services;

namespace TenantService.Controllers;

/// <summary>
/// Sirket kayit ucu. Tek ANONIM erisilebilir controller - yeni musteriler
/// buradan kaydolur.
/// </summary>
[ApiController]
[Route("api/registration")]
[AllowAnonymous]
public partial class RegistrationController : ControllerBase
{
    private readonly TenantDbContext _db;
    private readonly TenantProvisioningService _provisioning;
    private readonly ILogger<RegistrationController> _logger;

    public RegistrationController(
        TenantDbContext db, TenantProvisioningService provisioning,
        ILogger<RegistrationController> logger)
    {
        _db = db;
        _provisioning = provisioning;
        _logger = logger;
    }

    [GeneratedRegex(@"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
    private static partial Regex EmailRegex();

    /// <summary>Slug musait mi - kayit formunda anlik kontrol icin.</summary>
    [HttpGet("slug-available")]
    public async Task<IActionResult> SlugAvailable([FromQuery] string slug)
    {
        if (string.IsNullOrWhiteSpace(slug))
            return BadRequest(new { message = "Slug bos olamaz" });

        var taken = await _db.Tenants.AnyAsync(t => t.Slug == slug.ToLowerInvariant());
        return Ok(new { slug = slug.ToLowerInvariant(), available = !taken });
    }

    /// <summary>
    /// Kiracinin marka bilgisi (logo, ana renk) - ANONIM. LogoStorageService
    /// zaten logoyu "/logos/" altinda herkese acik yayinliyor; bu uc da ayni
    /// mantikla, oturum acilmadan ONCE veya baska bir servisten erisilmesi
    /// gereken yerler icin marka bilgisini dondurur. Su an tek tuketicisi
    /// notification-service (e-posta bildirim basligi) - cross-service
    /// cagirir, uc anonim oldugu icin JWT pass-through'a ihtiyac yoktur.
    /// Ileride tenant-farkinda bir giris ekrani icin de kullanilabilir.
    /// </summary>
    [HttpGet("branding/{slug}")]
    public async Task<IActionResult> Branding(string slug)
    {
        if (string.IsNullOrWhiteSpace(slug))
            return BadRequest(new { message = "Slug bos olamaz" });

        var tenant = await _db.Tenants
            .Where(t => t.Slug == slug.ToLowerInvariant())
            .Select(t => new { t.Name, t.LogoUrl, t.PrimaryColorHex })
            .FirstOrDefaultAsync();

        return tenant is null
            ? NotFound(new { message = $"'{slug}' icin tenant kaydi bulunamadi" })
            : Ok(tenant);
    }

    /// <summary>
    /// Yeni sirket kaydi. Basarili olursa yonetici e-postasina parola
    /// belirleme baglantisi gonderilir.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Register(
        [FromBody] RegisterCompanyRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.CompanyName))
            return BadRequest(new { message = "Şirket adı zorunlu" });
        if (string.IsNullOrWhiteSpace(request.AdminEmail) || !EmailRegex().IsMatch(request.AdminEmail))
            return BadRequest(new { message = "Geçerli bir e-posta adresi girin" });

        var email = request.AdminEmail.Trim().ToLowerInvariant();

        // Ayni e-posta ile birden fazla tenant yonetimi bu surumde desteklenmiyor.
        if (await _db.Tenants.AnyAsync(t => t.AdminEmail == email, ct))
        {
            return Conflict(new
            {
                message = "Bu e-posta ile kayıtlı bir şirket zaten var. " +
                          "Giris yapmayi deneyin ya da destek ile iletisime gecin.",
            });
        }

        var slug = string.IsNullOrWhiteSpace(request.Slug)
            ? await _provisioning.BuildUniqueSlugAsync(request.CompanyName, ct)
            : request.Slug.Trim().ToLowerInvariant();

        if (await _db.Tenants.AnyAsync(t => t.Slug == slug, ct))
            return Conflict(new { message = $"'{slug}' kisa adi kullanimda, baska bir ad secin" });

        try
        {
            var tenant = await _provisioning.ProvisionAsync(
                request.CompanyName.Trim(), slug, email,
                request.AdminFullName?.Trim(), request.EmailDomain?.Trim(),
                request.TaxNumber?.Trim(), request.Plan, ct);

            return Ok(new
            {
                tenantId = tenant.Id,
                slug = tenant.Slug,
                companyName = tenant.Name,
                status = tenant.Status.ToString(),
                message = $"Kaydınız oluşturuldu. {email} adresine parola belirleme " +
                          "bağlantısı gönderildi.",
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Kayıt başarısız: {Company}", request.CompanyName);
            return StatusCode(500, new
            {
                message = "Kayıt tamamlanamadı. Lütfen tekrar deneyin ya da destek ile " +
                          "iletişime geçin.",
            });
        }
    }
}

public record RegisterCompanyRequest(
    string CompanyName,
    string AdminEmail,
    string? AdminFullName,
    string? Slug,
    string? EmailDomain,
    /// <summary>
    /// Kayit sihirbazinin 3. adiminda secilen plan: "Trial" | "Standard" | "Enterprise".
    /// Once bu alan hic yoktu - kullanici ne secerse secsin varsayilan
    /// (Trial) uygulaniyordu. Gecersiz/bos deger de Trial'a duser, hata
    /// vermez - kayit akisini bozmak istemiyoruz.
    /// </summary>
    string? Plan,
    string? TaxNumber);
