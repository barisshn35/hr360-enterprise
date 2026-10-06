using CompensationService.Tenancy;

namespace CompensationService.Models;

public enum PayrollPeriodStatus { Open, Calculated, Closed }

/// <summary>Aylık bordro dönemi. Kapatılan dönem değiştirilemez (yeniden açma yalnızca kiracı yöneticisi, gerekçeyle).</summary>
public class PayrollPeriod : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Year { get; set; }
    public int Month { get; set; }
    public PayrollPeriodStatus Status { get; set; } = PayrollPeriodStatus.Open;
    public DateTimeOffset? CalculatedAt { get; set; }
    /// <summary>Görevler ayrılığı: son hesaplayanın kullanıcı kimliği (sub) ve adı. Hesaplayan dönemi kapatamaz.</summary>
    public string? CalculatedBy { get; set; }
    public string? CalculatedByName { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public string? ClosedBy { get; set; }
    /// <summary>Bordro denetiminin (ml-inference, ML dalgası 2) en son başarıyla çalıştığı an; ML yanıt vermediyse boş.</summary>
    public DateTimeOffset? AnomalyCheckedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Kiracının yıl bazında bordro parametreleri (yoksa yasal varsayılanlar kullanılır).</summary>
public class PayrollParameterSet : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public int Year { get; set; }
    public decimal MinimumWageGross { get; set; }
    public decimal SgkEmployerRate { get; set; }
    public decimal EmployerIncentivePoints { get; set; }
    public decimal StampTaxRate { get; set; }
    public decimal SgkCeilingMultiplier { get; set; }
    /// <summary>JSON: [{"upTo":190000,"rate":0.15},...,{"upTo":null,"rate":0.40}]</summary>
    public string BracketsJson { get; set; } = "[]";
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum PayrollAdjustmentKind { Addition, Deduction }

/// <summary>Döneme özel ek ödeme (prim, ikramiye) ya da kesinti (avans taksiti vb.).</summary>
public class PayrollAdjustment : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PeriodId { get; set; }
    public Guid EmployeeId { get; set; }
    public PayrollAdjustmentKind Kind { get; set; }
    public decimal Amount { get; set; }
    public string Description { get; set; } = "";
    /// <summary>Kaynağı başka bir kayıtsa (ör. avans taksiti) onun kimliği.</summary>
    public Guid? SourceId { get; set; }
    /// <summary>Elle girenin kullanıcı kimliği (sub); otomatik kalemlerde (avans taksiti) boş. Görevler ayrılığı için.</summary>
    public string? CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>Bordro pusulası satırı. KVKK: yalnızca çalışanın kendisi ve bordro yetkilisi görür.</summary>
public class Payslip : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PeriodId { get; set; }
    public Guid EmployeeId { get; set; }
    public int Year { get; set; }
    public int Month { get; set; }
    public string Currency { get; set; } = "TRY";
    public decimal MonthlyBaseGross { get; set; }
    public int PaidDays { get; set; }
    public int UnpaidDays { get; set; }
    public decimal OvertimeHours { get; set; }
    public decimal BaseGross { get; set; }
    public decimal OvertimePay { get; set; }
    public decimal Additions { get; set; }
    public decimal Gross { get; set; }
    public decimal SgkBase { get; set; }
    public decimal SgkEmployee { get; set; }
    public decimal UnemploymentEmployee { get; set; }
    public decimal TaxBase { get; set; }
    public decimal CumulativeTaxBase { get; set; }
    public decimal IncomeTax { get; set; }
    public decimal IncomeTaxExemption { get; set; }
    public decimal StampTax { get; set; }
    public decimal StampTaxExemption { get; set; }
    public decimal Deductions { get; set; }
    public decimal Net { get; set; }
    public decimal SgkEmployer { get; set; }
    public decimal UnemploymentEmployer { get; set; }
    public decimal EmployerCost { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Dönem hesaplanınca ml-inference'ın ürettiği denetim işaretleri - jsonb dizi: [{code, severity, reason, details}].
    /// Yalnızca bordro yetkilisi görür (ayrı uç: payroll/periods/{id}/anomalies); çalışanın kendi pusulası
    /// yanıtında YER ALMAZ (JsonIgnore). Hesaplamayı ve kapatmayı engellemez.
    /// </summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string? AnomalyFlagsJson { get; set; }
}
