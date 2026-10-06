using System.Text.Json;
using CompensationService.Models;

namespace CompensationService.Payroll;

/// <summary>
/// Madde 60 — bordro parametrelerinin dönem tarihine göre seçimi (saf; birim testli). Bir yılda birden
/// fazla satır olabilir (ValidFromMonth); dönem ayına göre yürürlüğe en son giren satır kullanılır.
/// O yıl için satır yoksa koddaki yasal varsayılanlar (<see cref="PayrollDefaults"/>) geçerlidir; böylece
/// tohum satırları (varsayılanlarla aynı değerler) mevcut dönemlerin sonucunu değiştirmez.
/// </summary>
public static class PayrollParameterResolver
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Ay için geçerli satır (yoksa null).</summary>
    public static PayrollParameterSet? RowFor(IEnumerable<PayrollParameterSet> rows, int year, int month) =>
        rows.Where(r => r.Year == year && r.ValidFromMonth <= Math.Clamp(month, 1, 12))
            .OrderByDescending(r => r.ValidFromMonth).FirstOrDefault();

    public static PayrollParams Resolve(IEnumerable<PayrollParameterSet> rows, int year, int month)
    {
        var d = PayrollDefaults.For(year);
        var row = RowFor(rows, year, month);
        return row is null ? d : Apply(d, row);
    }

    public static PayrollParams Apply(PayrollParams d, PayrollParameterSet row)
    {
        List<TaxBracket>? brackets = null;
        try { brackets = JsonSerializer.Deserialize<List<TaxBracket>>(row.BracketsJson, Json); }
        catch (JsonException) { }
        return d with
        {
            MinimumWageGross = row.MinimumWageGross,
            SgkEmployeeRate = row.SgkEmployeeRate,
            UnemploymentEmployeeRate = row.UnemploymentEmployeeRate,
            SgkEmployerRate = row.SgkEmployerRate,
            EmployerIncentivePoints = row.EmployerIncentivePoints,
            UnemploymentEmployerRate = row.UnemploymentEmployerRate,
            StampTaxRate = row.StampTaxRate,
            SgkCeilingMultiplier = row.SgkCeilingMultiplier,
            Brackets = brackets is { Count: > 0 } ? brackets : d.Brackets,
            MinimumWageExemption = row.MinimumWageExemption,
        };
    }

    /// <summary>
    /// Kıdem tazminatı tavanı (tarih yarıyılına göre). Satır yoksa ya da tavan girilmemişse
    /// <paramref name="fallback"/> (ör. SEVERANCE_CEILING_TRY ortam değişkeni ya da kod varsayılanı).
    /// </summary>
    public static decimal SeveranceCeiling(IEnumerable<PayrollParameterSet> rows, DateOnly date, decimal fallback)
    {
        var row = RowFor(rows, date.Year, date.Month);
        var v = date.Month <= 6 ? row?.SeveranceCeilingH1 : row?.SeveranceCeilingH2 ?? row?.SeveranceCeilingH1;
        return v is > 0 ? v.Value : fallback;
    }

    /// <summary>Kod varsayılanı kıdem tavanı (01.07.2026–31.12.2026; SEVERANCE_CEILING_TRY ile değiştirilebilir).</summary>
    public static decimal DefaultSeveranceCeiling =>
        decimal.TryParse(Environment.GetEnvironmentVariable("SEVERANCE_CEILING_TRY"), System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out var v) && v > 0 ? v : 73_729.87m;

    /// <summary>Girdi denetimi; hata yoksa null. Oranlar 0–1 arası kesir (0,14 = %14).</summary>
    public static string? Validate(int year, int validFromMonth, decimal minimumWageGross, decimal sgkEmployeeRate, decimal unemploymentEmployeeRate,
        decimal sgkEmployerRate, decimal incentivePoints, decimal unemploymentEmployerRate, decimal stampTaxRate, decimal ceilingMultiplier,
        IReadOnlyList<TaxBracket>? brackets, decimal? ceilingH1, decimal? ceilingH2)
    {
        if (year is < 2020 or > 2100) return "Geçersiz yıl";
        if (validFromMonth is < 1 or > 12) return "Yürürlük ayı 1–12 olmalı";
        if (minimumWageGross <= 0 || sgkEmployerRate is < 0 or > 1 || stampTaxRate is < 0 or > 0.1m
            || incentivePoints is < 0 or > 20 || ceilingMultiplier is < 1 or > 20
            || sgkEmployeeRate is < 0 or > 0.5m || unemploymentEmployeeRate is < 0 or > 0.1m || unemploymentEmployerRate is < 0 or > 0.1m
            || ceilingH1 is < 0 || ceilingH2 is < 0)
            return "Parametre değerleri geçersiz";
        var br = brackets ?? Array.Empty<TaxBracket>();
        if (br.Count is < 1 or > 10 || br[^1].UpTo is not null || br.Any(b => b.Rate is < 0 or > 1)
            || br.Take(br.Count - 1).Any(b => b.UpTo is null or <= 0)
            || br.Take(br.Count - 1).Zip(br.Skip(1).Take(br.Count - 2)).Any(x => x.First.UpTo >= x.Second.UpTo))
            return "Vergi dilimleri artan sınırlarla girilmeli; son dilimin üst sınırı boş olmalı";
        return null;
    }
}
