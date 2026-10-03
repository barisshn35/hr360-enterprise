namespace CompensationService.Payroll;

/// <summary>Gelir vergisi tarifesinde bir dilim: üst sınır (son dilimde null) ve oran.</summary>
public sealed record TaxBracket(decimal? UpTo, decimal Rate);

/// <summary>
/// Bir yılın bordro parametreleri. Varsayılanlar resmi kaynaklardan alınmıştır; kiracı
/// kendi değerleriyle (ör. teşvik puanı) değiştirebilir.
/// </summary>
public sealed record PayrollParams(
    int Year,
    decimal MinimumWageGross,            // aylık brüt asgari ücret
    decimal SgkEmployeeRate,             // SGK işçi payı
    decimal UnemploymentEmployeeRate,    // işsizlik sigortası işçi payı
    decimal SgkEmployerRate,             // SGK işveren payı (teşviksiz)
    decimal EmployerIncentivePoints,     // 5510 s. K. teşvik indirimi (puan)
    decimal UnemploymentEmployerRate,    // işsizlik sigortası işveren payı
    decimal StampTaxRate,                // damga vergisi
    decimal SgkCeilingMultiplier,        // SGK tavanı = asgari ücret x çarpan
    decimal OvertimeMultiplier,          // fazla mesai zammı (İş K. m.41: %50)
    decimal MonthlyHours,                // saatlik ücret böleni (225 saat)
    IReadOnlyList<TaxBracket> Brackets)
{
    public decimal EffectiveEmployerSgkRate => Math.Max(0, SgkEmployerRate - EmployerIncentivePoints / 100m);
}

public static class PayrollDefaults
{
    /// <summary>
    /// 2026: brüt asgari ücret 33.030,00 TL, SGK tavanı 9 kat (297.270,00 TL), işveren SGK
    /// payı %21,75 (imalat dışı 2 puan teşvik), ücret gelirleri tarifesi 190 bin / 400 bin /
    /// 1,5 milyon / 5,3 milyon. 2025: 26.005,50 TL, 7,5 kat, %20,75 (5 puan teşvik).
    /// </summary>
    public static PayrollParams For(int year) => year switch
    {
        <= 2025 => new PayrollParams(year, 26005.50m, 0.14m, 0.01m, 0.2075m, 5m, 0.02m, 0.00759m, 7.5m, 1.5m, 225m, new[]
        {
            new TaxBracket(158_000m, 0.15m), new TaxBracket(330_000m, 0.20m), new TaxBracket(1_200_000m, 0.27m),
            new TaxBracket(4_300_000m, 0.35m), new TaxBracket(null, 0.40m),
        }),
        _ => new PayrollParams(year, 33030.00m, 0.14m, 0.01m, 0.2175m, 2m, 0.02m, 0.00759m, 9m, 1.5m, 225m, new[]
        {
            new TaxBracket(190_000m, 0.15m), new TaxBracket(400_000m, 0.20m), new TaxBracket(1_500_000m, 0.27m),
            new TaxBracket(5_300_000m, 0.35m), new TaxBracket(null, 0.40m),
        }),
    };
}

/// <summary>Bir çalışanın bir aylık bordro girdisi.</summary>
public sealed record PayrollInput(
    int Month,
    decimal MonthlyBaseGross,
    int UnpaidDays,                 // ücretsiz izin / eksik gün (takvim günü)
    decimal OvertimeHours,          // onaylı fazla mesai
    decimal Additions,              // vergiye tabi ek ödemeler (prim, ikramiye)
    decimal Deductions,             // net ücretten kesintiler (avans, icra vb.)
    decimal PriorCumulativeTaxBase); // aynı yılın önceki aylarındaki GV matrahı toplamı

public sealed record PayrollResult(
    int PaidDays, decimal BaseGross, decimal OvertimePay, decimal Additions, decimal Gross,
    decimal SgkBase, decimal SgkEmployee, decimal UnemploymentEmployee,
    decimal TaxBase, decimal CumulativeTaxBase, decimal IncomeTax, decimal IncomeTaxExemption,
    decimal StampTax, decimal StampTaxExemption, decimal Deductions, decimal Net,
    decimal SgkEmployer, decimal UnemploymentEmployer, decimal EmployerCost);

/// <summary>
/// Türkiye aylık ücret bordrosu (brütten nete). Yöntem:
///   brüt = taban ücret x ödenen gün/30 + fazla mesai (saatlik ücret x 1,5) + ek ödemeler
///   SGK matrahı = brüt, ödenen güne göre taban (asgari ücret) ve tavan (asgari ücret x çarpan) arasında
///   GV matrahı = brüt - SGK işçi - işsizlik işçi; GV kümülatif matraha göre artan oranlı
///   asgari ücret istisnası (GVK m.23/18): asgari ücretin GV'si ve damga vergisi kadar
///   (ödenen güne oranlanır) — çalışanın vergisini aşamaz
/// Her adım kuruşa yuvarlanır.
/// </summary>
public static class PayrollCalculator
{
    static decimal R(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero);

    /// <summary>Kümülatif matrah için toplam gelir vergisi.</summary>
    public static decimal Tax(decimal income, IReadOnlyList<TaxBracket> brackets)
    {
        if (income <= 0) return 0;
        decimal tax = 0, lower = 0;
        foreach (var b in brackets)
        {
            var upper = b.UpTo ?? decimal.MaxValue;
            if (income <= lower) break;
            tax += (Math.Min(income, upper) - lower) * b.Rate;
            lower = upper;
        }
        return tax;
    }

    /// <summary>Kümülatif matrah önceki + bu ay iken bu aya düşen vergi.</summary>
    public static decimal MonthlyTax(decimal priorCumulative, decimal monthBase, IReadOnlyList<TaxBracket> brackets) =>
        R(Tax(priorCumulative + monthBase, brackets) - Tax(priorCumulative, brackets));

    public static PayrollResult Calculate(PayrollParams p, PayrollInput i)
    {
        if (i.Month is < 1 or > 12) throw new ArgumentOutOfRangeException(nameof(i), "Ay 1-12 arasında olmalı");
        var paidDays = Math.Clamp(30 - i.UnpaidDays, 0, 30);
        var dayRatio = paidDays / 30m;

        var baseGross = R(i.MonthlyBaseGross * dayRatio);
        var hourly = i.MonthlyBaseGross / p.MonthlyHours;
        var overtimePay = R(hourly * p.OvertimeMultiplier * Math.Max(0, i.OvertimeHours));
        var additions = R(Math.Max(0, i.Additions));
        var gross = baseGross + overtimePay + additions;

        var floor = R(p.MinimumWageGross * dayRatio);
        var ceiling = R(p.MinimumWageGross * p.SgkCeilingMultiplier * dayRatio);
        var sgkBase = paidDays == 0 ? 0 : Math.Clamp(gross, floor, ceiling);
        var sgkEmp = R(sgkBase * p.SgkEmployeeRate);
        var unempEmp = R(sgkBase * p.UnemploymentEmployeeRate);

        var taxBase = Math.Max(0, gross - sgkEmp - unempEmp);
        var incomeTax = MonthlyTax(i.PriorCumulativeTaxBase, taxBase, p.Brackets);

        // Asgari ücret istisnası: asgari ücretin (ödenen güne oranlanmış) kendi GV matrahı ve
        // aynı yılın önceki aylarındaki asgari ücret matrahı üzerinden hesaplanan vergi.
        var mwBaseFull = p.MinimumWageGross * (1 - p.SgkEmployeeRate - p.UnemploymentEmployeeRate);
        var mwMonthBase = R(mwBaseFull * dayRatio);
        var mwPrior = R(mwBaseFull * (i.Month - 1));
        var taxExemption = Math.Min(incomeTax, MonthlyTax(mwPrior, mwMonthBase, p.Brackets));

        var stamp = R(gross * p.StampTaxRate);
        var stampExemption = Math.Min(stamp, R(p.MinimumWageGross * dayRatio * p.StampTaxRate));

        var deductions = R(Math.Max(0, i.Deductions));
        var net = gross - sgkEmp - unempEmp - (incomeTax - taxExemption) - (stamp - stampExemption) - deductions;

        var sgkEr = R(sgkBase * p.EffectiveEmployerSgkRate);
        var unempEr = R(sgkBase * p.UnemploymentEmployerRate);

        return new PayrollResult(paidDays, baseGross, overtimePay, additions, gross, sgkBase, sgkEmp, unempEmp,
            taxBase, i.PriorCumulativeTaxBase + taxBase, incomeTax, taxExemption, stamp, stampExemption, deductions,
            net, sgkEr, unempEr, gross + sgkEr + unempEr);
    }
}
