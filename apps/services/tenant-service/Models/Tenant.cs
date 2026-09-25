namespace TenantService.Models;

public enum TenantStatus
{
    /// <summary>Kayit alindi, admin henuz parolasini belirlemedi.</summary>
    Pending,
    Active,
    /// <summary>Odeme/kota nedeniyle askiya alindi - giris engellenir.</summary>
    Suspended,
    Cancelled
}

public enum TenantPlan { Trial, Standard, Enterprise }

/// <summary>
/// Bir musteri sirketi. Keycloak'taki Organization ile 1-1 eslesir
/// (KeycloakOrgId + Slug). Tum is verisi bu kaydin Id'siyle izole edilir.
/// </summary>
public class Tenant
{
    public Guid Id { get; set; } = Guid.NewGuid();

    /// <summary>Gorunen ad: "Acme Yazilim A.S."</summary>
    public required string Name { get; set; }

    /// <summary>
    /// URL/claim dostu benzersiz kisa ad: "acme-yazilim".
    /// Keycloak Organization alias'i olarak da kullanilir - JWT'deki
    /// organization claim'i bu degeri tasir.
    /// </summary>
    public required string Slug { get; set; }

    /// <summary>Sirketin e-posta alan adi: "acme.com.tr". Davet dogrulamasinda kullanilir.</summary>
    public string? EmailDomain { get; set; }

    public string? TaxNumber { get; set; }
    public TenantStatus Status { get; set; } = TenantStatus.Pending;
    public TenantPlan Plan { get; set; } = TenantPlan.Trial;

    /// <summary>Keycloak Organization kimligi - saglama sonrasi doldurulur.</summary>
    public string? KeycloakOrgId { get; set; }

    /// <summary>Ilk yonetici (tenant-admin) - Keycloak kullanici kimligi.</summary>
    public string? AdminUserId { get; set; }
    public required string AdminEmail { get; set; }
    public string? AdminFullName { get; set; }

    /// <summary>Plan bazli kota. Asilirsa yeni calisan eklenemez.</summary>
    public int MaxEmployees { get; set; } = 25;

    // --- Beyaz etiketleme (white-label) - SADECE Enterprise plan ---
    /// <summary>MinIO'da saklanan logo dosyasinin yolu. Enterprise disi planlarda kullanilmaz.</summary>
    public string? LogoUrl { get; set; }

    /// <summary>
    /// Sirketin arayuzde kullandigi ana renk, "#c0392b" formatinda hex.
    /// Frontend --primary CSS degiskenini runtime'da bununla override eder;
    /// --primary-foreground (metin rengi) renk parlakligindan otomatik
    /// hesaplanir, tenant ayarlamaz. Enterprise disi planlarda kullanilmaz.
    /// </summary>
    public string? PrimaryColorHex { get; set; }

    /// <summary>
    /// Tenant'in kendi SMTP sunucusu (opsiyonel, Enterprise). Bos ise
    /// platformun varsayilan gonderim borusu (Brevo) kullanilir.
    /// SmtpPasswordEncrypted DB'de duz metin TUTULMAZ - bkz. SmtpCredentialProtector.
    /// </summary>
    public string? SmtpHost { get; set; }
    public int? SmtpPort { get; set; }
    public string? SmtpUser { get; set; }
    public string? SmtpPasswordEncrypted { get; set; }
    public string? SmtpFromAddress { get; set; }
    public string? SmtpFromName { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? ActivatedAt { get; set; }
    public DateTimeOffset? SuspendedAt { get; set; }
    public string? SuspendReason { get; set; }
}
