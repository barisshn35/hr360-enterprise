using NotificationService.Tenancy;

namespace NotificationService.Models;

/// <summary>
/// Çalışanın bildirim dili (tr | en). Arayüzde dil değiştirildiğinde güncellenir;
/// e-posta ve bildirim metinleri bu dilde üretilir. Kayıt yoksa Türkçe.
/// </summary>
public class NotificationPreference : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid EmployeeId { get; set; }
    public string Language { get; set; } = "tr";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}
