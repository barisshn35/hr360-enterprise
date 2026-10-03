using ExpenseService.Tenancy;

namespace ExpenseService.Models;

public enum ExpenseCategory { Travel, Meal, Accommodation, Transport, Supplies, Training, Other, Mileage, PerDiem }

public class ExpenseItem : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ClaimId { get; set; }
    public ExpenseClaim? Claim { get; set; }
    public ExpenseCategory Category { get; set; } = ExpenseCategory.Other;
    public decimal Amount { get; set; }
    public DateOnly ExpenseDate { get; set; }
    public string? Description { get; set; }
    /// <summary>Fis/fatura gorselinin MinIO storage anahtari.</summary>
    public string? ReceiptStorageKey { get; set; }
    /// <summary>Yabancı para harcaması: girilen tutar ve para birimi; Amount, harcama günündeki TCMB kuruyla TL karşılığıdır.</summary>
    public string? OriginalCurrency { get; set; }
    public decimal? OriginalAmount { get; set; }
    public decimal? FxRate { get; set; }
    /// <summary>Kilometre masrafı: km × kiracının km ücreti.</summary>
    public decimal? Km { get; set; }
    /// <summary>Bağlı seyahat (harcırah/seyahat masrafı).</summary>
    public Guid? TravelRequestId { get; set; }
}
