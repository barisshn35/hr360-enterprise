using LeaveService.Tenancy;

namespace LeaveService.Models;

/// <summary>
/// Sirketin resmi tatil takvimindeki bir gun. Izin gunu hesabinda (is gunu) bu gunler
/// dusulur. Takvimi IK girer: dini bayramlarin tarihi her yil degistigi icin sabit bir
/// liste gomulmedi.
/// </summary>
public class PublicHoliday : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public DateOnly Date { get; set; }
    public required string Name { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
