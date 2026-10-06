using System.Text;
using System.Text.Json;
using CompensationService.Models;
using CompensationService.Payroll;
using Xunit;

namespace Compensation.Tests;

/// <summary>Bordro dalgası 8 (madde 58–65): parametre seçimi, APHB, IBAN/banka, kıdem/ihbar, fark bordrosu, fiş dengesi, e-bordro, compa-ratio.</summary>
public class PayrollTrTests
{
    static PayrollParameterSet Row(int year, int from, PayrollParams p, decimal? h1 = null, decimal? h2 = null) => new()
    {
        Year = year, ValidFromMonth = from, MinimumWageGross = p.MinimumWageGross, SgkEmployeeRate = p.SgkEmployeeRate,
        UnemploymentEmployeeRate = p.UnemploymentEmployeeRate, SgkEmployerRate = p.SgkEmployerRate, EmployerIncentivePoints = p.EmployerIncentivePoints,
        UnemploymentEmployerRate = p.UnemploymentEmployerRate, StampTaxRate = p.StampTaxRate, SgkCeilingMultiplier = p.SgkCeilingMultiplier,
        BracketsJson = JsonSerializer.Serialize(p.Brackets, new JsonSerializerOptions(JsonSerializerDefaults.Web)),
        SeveranceCeilingH1 = h1, SeveranceCeilingH2 = h2,
    };

    static Payslip Slip(PayrollResult r, PayrollInput i, Guid emp, Guid period, int year) => new()
    {
        EmployeeId = emp, PeriodId = period, Year = year, Month = i.Month, MonthlyBaseGross = i.MonthlyBaseGross, PaidDays = r.PaidDays,
        UnpaidDays = 30 - r.PaidDays, OvertimeHours = i.OvertimeHours, BaseGross = r.BaseGross, OvertimePay = r.OvertimePay, Additions = r.Additions,
        Gross = r.Gross, SgkBase = r.SgkBase, SgkEmployee = r.SgkEmployee, UnemploymentEmployee = r.UnemploymentEmployee, TaxBase = r.TaxBase,
        CumulativeTaxBase = r.CumulativeTaxBase, IncomeTax = r.IncomeTax, IncomeTaxExemption = r.IncomeTaxExemption, StampTax = r.StampTax,
        StampTaxExemption = r.StampTaxExemption, Deductions = r.Deductions, Net = r.Net, SgkEmployer = r.SgkEmployer,
        UnemploymentEmployer = r.UnemploymentEmployer, EmployerCost = r.EmployerCost,
    };

    /* ------------------------------------------------------------ 60 parametreler (regresyon) */

    [Theory]
    [InlineData(2025, 1, 26005.50)]
    [InlineData(2025, 9, 120_000)]
    [InlineData(2026, 1, 33030)]
    [InlineData(2026, 7, 400_000)]
    [InlineData(2026, 12, 75_000)]
    public void Tohum_satirlari_kod_varsayilaniyla_ayni_sonucu_verir(int year, int month, double gross)
    {
        var d = PayrollDefaults.For(year);
        var fromRows = PayrollParameterResolver.Resolve(new[] { Row(year, 1, d) }, year, month);
        var input = new PayrollInput(month, (decimal)gross, 3, 4, 1000, 250, 50_000);
        Assert.Equal(PayrollCalculator.Calculate(d, input), PayrollCalculator.Calculate(fromRows, input));
        // Satır yoksa koddaki yasal varsayılan.
        var none = PayrollParameterResolver.Resolve(Array.Empty<PayrollParameterSet>(), year, month);
        Assert.Equal(d with { Brackets = none.Brackets }, none);
        Assert.Equal(d.Brackets, fromRows.Brackets);
    }

    [Fact]
    public void Yariyil_satiri_temmuzdan_itibaren_gecerli()
    {
        var d = PayrollDefaults.For(2026);
        var rows = new[] { Row(2026, 1, d), Row(2026, 7, d with { MinimumWageGross = 36_000m }) };
        Assert.Equal(33030m, PayrollParameterResolver.Resolve(rows, 2026, 6).MinimumWageGross);
        Assert.Equal(36_000m, PayrollParameterResolver.Resolve(rows, 2026, 7).MinimumWageGross);
        Assert.Equal(36_000m, PayrollParameterResolver.Resolve(rows, 2026, 12).MinimumWageGross);
    }

    [Fact]
    public void Kidem_tavani_yariyila_gore_ve_yedek_deger()
    {
        var d = PayrollDefaults.For(2025);
        var rows = new[] { Row(2025, 1, d, 46_655.43m, 53_919.68m) };
        Assert.Equal(46_655.43m, PayrollParameterResolver.SeveranceCeiling(rows, new DateOnly(2025, 6, 30), 1));
        Assert.Equal(53_919.68m, PayrollParameterResolver.SeveranceCeiling(rows, new DateOnly(2025, 7, 1), 1));
        Assert.Equal(99m, PayrollParameterResolver.SeveranceCeiling(rows, new DateOnly(2024, 7, 1), 99));
    }

    [Fact]
    public void Asgari_ucret_istisnasi_kapatilinca_vergi_tam_kesilir()
    {
        var p = PayrollDefaults.For(2026) with { MinimumWageExemption = false };
        var r = PayrollCalculator.Calculate(p, new PayrollInput(1, 33030m, 0, 0, 0, 0, 0));
        Assert.Equal(0, r.IncomeTaxExemption);
        Assert.Equal(0, r.StampTaxExemption);
        Assert.True(r.Net < 28075.50m);
    }

    [Fact]
    public void Parametre_dogrulamasi()
    {
        var b = PayrollDefaults.For(2026).Brackets;
        Assert.Null(PayrollParameterResolver.Validate(2026, 7, 33030, 0.14m, 0.01m, 0.2175m, 2, 0.02m, 0.00759m, 9, b, 64948.77m, 73729.87m));
        Assert.NotNull(PayrollParameterResolver.Validate(2026, 13, 33030, 0.14m, 0.01m, 0.2175m, 2, 0.02m, 0.00759m, 9, b, null, null));
        Assert.NotNull(PayrollParameterResolver.Validate(2026, 1, 33030, 0.14m, 0.01m, 0.2175m, 2, 0.02m, 0.00759m, 9,
            new[] { new TaxBracket(100, 0.15m), new TaxBracket(50, 0.2m), new TaxBracket(null, 0.4m) }, null, null));
    }

    /* ------------------------------------------------------------ 58 APHB */

    static readonly Guid A = Guid.Parse("00000000-0000-0000-0000-00000000000a");
    static readonly Guid B = Guid.Parse("00000000-0000-0000-0000-00000000000b");
    static readonly Guid C = Guid.Parse("00000000-0000-0000-0000-00000000000c");

    static (PayrollPeriod, List<Payslip>, Dictionary<Guid, AphbPerson>) AphbSample()
    {
        var p = PayrollDefaults.For(2026);
        var period = new PayrollPeriod { Year = 2026, Month = 3 };
        var ia = new PayrollInput(3, 60_000m, 5, 2, 3_000, 0, 0);
        var ib = new PayrollInput(3, 33_030m, 0, 0, 0, 0, 0);
        var ic = new PayrollInput(3, 50_000m, 0, 0, 0, 0, 0);
        var slips = new List<Payslip>
        {
            Slip(PayrollCalculator.Calculate(p, ia), ia, A, period.Id, 2026),
            Slip(PayrollCalculator.Calculate(p, ib), ib, B, period.Id, 2026),
            Slip(PayrollCalculator.Calculate(p, ic), ic, C, period.Id, 2026),
        };
        var people = new Dictionary<Guid, AphbPerson>
        {
            [A] = new(A, "Ayşe", "Yılmaz", "10000000146", new DateOnly(2026, 3, 10), null, null, "2512.01", null, null, false),
            [B] = new(B, "İsmail", "Çelik", "10000000146", new DateOnly(2020, 1, 1), new DateOnly(2026, 3, 20), "Resignation", null, null, "05746", true),
            [C] = new(C, "Can", "Öz", "12345", new DateOnly(2020, 1, 1), null, null, "1120.03", null, null, false),
        };
        return (period, slips, people);
    }

    [Fact]
    public void Aphb_satirlari_ve_dogrulama_bulgulari()
    {
        var (period, slips, people) = AphbSample();
        var leave = new Dictionary<Guid, Dictionary<string, decimal>> { [A] = new() { ["Unpaid"] = 5 } };
        var (rows, issues) = Aphb.Build(period, slips, people, leave, new SgkSettings(), PayrollDefaults.For(2026));
        Assert.Equal(2, rows.Count);                                           // C: geçersiz TCKN, dosyaya girmez
        Assert.Contains(issues, i => i.EmployeeId == C && i.Level == "error" && i.Code == "tckn");
        Assert.Contains(issues, i => i.EmployeeId == B && i.Code == "occupation");
        Assert.Contains(issues, i => i.EmployeeId == B && i.Code == "sgdp");
        var a = rows.Single(r => r.EmployeeId == A);
        Assert.Equal(25, a.PrimDays);
        Assert.Equal(5, a.MissingDays);
        Assert.Equal("21", a.MissingReason);                                   // ücretsiz izin → 21
        Assert.Equal("10", a.EntryDay);
        Assert.Equal(a.Pek, a.Wage + a.Bonus);
        Assert.Equal("01", a.DocumentType);
        var b = rows.Single(r => r.EmployeeId == B);
        Assert.Equal("02", b.DocumentType);                                    // SGDP
        Assert.Equal("05746", b.LawNo);
        Assert.Equal("20", b.ExitDay);
        Assert.Equal("03", b.ExitReasonCode);                                  // istifa
    }

    [Fact]
    public void Aphb_pek_tavan_ve_gun_uyarilari()
    {
        var p = PayrollDefaults.For(2026);
        var period = new PayrollPeriod { Year = 2026, Month = 3 };
        var slip = new Payslip { EmployeeId = A, PaidDays = 31, UnpaidDays = 0, SgkBase = 400_000m, BaseGross = 400_000m, Year = 2026, Month = 3 };
        var low = new Payslip { EmployeeId = B, PaidDays = 30, UnpaidDays = 0, SgkBase = 1_000m, BaseGross = 1_000m, Year = 2026, Month = 3 };
        var people = new Dictionary<Guid, AphbPerson>
        {
            [A] = new(A, "A", "B", "10000000146", new DateOnly(2020, 1, 1), null, null, "2512.01", null, null, false),
            [B] = new(B, "C", "D", "10000000146", new DateOnly(2020, 1, 1), null, null, "2512.01", null, null, false),
        };
        var (rows, issues) = Aphb.Build(period, new[] { slip, low }, people, new Dictionary<Guid, Dictionary<string, decimal>>(), new SgkSettings(), p);
        Assert.Contains(issues, i => i.EmployeeId == A && i.Code == "days" && i.Level == "error");
        Assert.Contains(issues, i => i.EmployeeId == B && i.Code == "pek_floor");
        Assert.Single(rows);
        var (_, issues2) = Aphb.Build(period, new[] { new Payslip { EmployeeId = A, PaidDays = 30, SgkBase = 400_000m, BaseGross = 400_000m } }, people, new Dictionary<Guid, Dictionary<string, decimal>>(), new SgkSettings(), p);
        Assert.Contains(issues2, i => i.Code == "pek_ceiling");
    }

    [Theory]
    [InlineData(0, "", "")]
    [InlineData(3, "Unpaid", "21")]
    [InlineData(3, "Annual", "13")]
    public void Eksik_gun_nedeni(int days, string type, string expected)
    {
        var map = type == "" ? null : new Dictionary<string, decimal> { [type] = days };
        Assert.Equal(expected, Aphb.MissingReason(days, map, new SgkSettings()));
    }

    [Fact]
    public void Birden_fazla_eksik_gun_nedeni_12()
    {
        var s = new SgkSettings { MissingDayCodes = new() { new("Unpaid", "21", true), new("Sick", "01", true) } };
        Assert.Equal("12", Aphb.MissingReason(5, new Dictionary<string, decimal> { ["Unpaid"] = 2, ["Sick"] = 3 }, s));
        Assert.Equal(new[] { "Unpaid", "Sick" }, s.PayReducingLeaveTypes());
        Assert.Equal(new[] { "Unpaid" }, new SgkSettings().PayReducingLeaveTypes());   // varsayılan = önceki davranış
    }

    [Fact]
    public void Aphb_xml_ve_txt_yerlesimi()
    {
        var (period, slips, people) = AphbSample();
        var (rows, _) = Aphb.Build(period, slips, people, new Dictionary<Guid, Dictionary<string, decimal>>(), new SgkSettings { WorkplaceRegistryNo = "1234" }, PayrollDefaults.For(2026));
        var xml = Encoding.UTF8.GetString(Aphb.Xml(period, rows, people, "Demo A.Ş.", new SgkSettings { WorkplaceRegistryNo = "1234" }));
        Assert.Contains("<AYLIKPRIMHIZMETBELGESI", xml);
        Assert.Contains("encoding=\"UTF-8\"", xml);
        Assert.Contains("<TCKIMLIKNO>10000000146</TCKIMLIKNO>", xml);
        Assert.Contains("<AD>İSMAİL</AD>", xml);                              // Türkçe büyük harf (İ)
        Assert.Contains("<MESLEKKODU>2512.01</MESLEKKODU>", xml);
        Assert.Contains("belgeTuru=\"02\" kanunNo=\"05746\"", xml);
        Assert.Equal(2, xml.Split("<BELGE ").Length - 1);
        var txt = Encoding.UTF8.GetString(Aphb.Txt(rows, people)).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(2, txt.Length);
        Assert.All(txt, l => Assert.Equal(Aphb.TxtColumns.Length, l.Split(';').Length));
        Assert.StartsWith("01;05510;10000000146;AYŞE;YILMAZ;25;", txt[0]);
    }

    /* ------------------------------------------------------------ 62 IBAN ve banka dosyası */

    [Theory]
    [InlineData("TR330006100519786457841326", true)]
    [InlineData("TR33 0006 1005 1978 6457 8413 26", true)]
    [InlineData("TR330006100519786457841327", false)]                      // kontrol hanesi bozuk
    [InlineData("TR3300061005197864578413", false)]                         // TR 26 karakter olmalı
    [InlineData("DE89370400440532013000", false)]                           // maaş dosyası yalnızca TR IBAN
    [InlineData("", false)]
    [InlineData("XX00", false)]
    public void Iban_mod97(string iban, bool ok) => Assert.Equal(ok, Exporters.ValidIban(iban));

    [Theory]
    [InlineData("DE89370400440532013000", true)]
    [InlineData("GB82WEST12345698765432", true)]
    [InlineData("GB82WEST12345698765433", false)]
    [InlineData("TR330006100519786457841326", true)]
    public void Iban_her_ulke_mod97(string iban, bool ok) => Assert.Equal(ok, Exporters.ValidIbanAny(iban));

    static (PayrollPeriod, List<Payslip>, Dictionary<Guid, ExportPerson>) BankSample()
    {
        var period = new PayrollPeriod { Year = 2026, Month = 4 };
        var slips = new List<Payslip>
        {
            new() { EmployeeId = A, Net = 28_075.50m, Currency = "TRY" },
            new() { EmployeeId = B, Net = 41_234.56m, Currency = "TRY" },
            new() { EmployeeId = C, Net = 10m, Currency = "TRY" },
        };
        var people = new Dictionary<Guid, ExportPerson>
        {
            [A] = new(A, "Ayşe", "Şahin", "10000000146", "TR330006100519786457841326", "Mühendislik", new DateOnly(2020, 1, 1), null),
            [B] = new(B, "Çağrı", "Öğüt", null, "TR33 0006 1005 1978 6457 8413 26", "Satış", new DateOnly(2020, 1, 1), null),
            [C] = new(C, "Can", "Er", null, "TR000000", "Satış", new DateOnly(2020, 1, 1), null),
        };
        return (period, slips, people);
    }

    [Fact]
    public void Banka_ornek_a_toplam_satiri_ve_ascii()
    {
        var (period, slips, people) = BankSample();
        var r = BankFiles.Build(period, slips, people, new BankSettings { Template = "ornek-a" }, new DateOnly(2026, 5, 1));
        var text = Encoding.Latin1.GetString(r.Content);
        Assert.Equal(2, r.Rows);
        Assert.Single(r.Warnings);                                              // C: geçersiz IBAN
        Assert.Contains("CAGRI OGUT", text);
        Assert.Contains("TOPLAM;2;;69310,06;TRY;;", text);
        Assert.Contains("01.05.2026", text);
    }

    [Fact]
    public void Banka_ornek_b_sabit_uzunluk()
    {
        var (period, slips, people) = BankSample();
        var r = BankFiles.Build(period, slips, people, new BankSettings { Template = "ornek-b", CompanyCode = "HR360", DebitIban = "TR330006100519786457841326" }, new DateOnly(2026, 5, 1));
        var lines = Encoding.Latin1.GetString(r.Content).Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal(4, lines.Length);
        Assert.Equal(66, lines[0].Length);
        Assert.All(lines.Skip(1).Take(2), l => Assert.Equal(121, l.Length));
        Assert.Equal("T000002000000006931006", lines[3]);                      // 2 kayıt, 69.310,06 TL = 6931006 kuruş
    }

    [Fact]
    public void Banka_ozel_duzen_virgullu_ondalik()
    {
        var (period, slips, people) = BankSample();
        var b = new BankSettings { Template = "custom", Custom = new BankCustomLayout { Delimiter = "|", DecimalSeparator = ",", Columns = new() { "seq", "iban", "amount", "name" }, Encoding = "utf-8", Ascii = false } };
        var text = Encoding.UTF8.GetString(BankFiles.Build(period, slips, people, b, new DateOnly(2026, 5, 1)).Content);
        Assert.StartsWith("SEQ|IBAN|AMOUNT|NAME\r\n", text);
        Assert.Contains("|TR330006100519786457841326|28075,50|AYŞE ŞAHİN\r\n", text);
        Assert.Contains("TOPLAM|", text);
        Assert.Contains("|69310,06|", text);
        Assert.Null(PayrollSettingsModel.Validate(null, null, null, b));
        Assert.NotNull(PayrollSettingsModel.Validate(null, null, null, b with { Custom = b.Custom with { Columns = new() { "name", "amount" } } }));
    }

    /* ------------------------------------------------------------ 61 kıdem ve ihbar */

    [Fact]
    public void Kidem_ve_ihbar_bir_yil_isveren_feshi()
    {
        var p = PayrollDefaults.For(2025);
        var r = SeveranceCalculator.Compute(new SeveranceInput(new DateOnly(2025, 1, 1), new DateOnly(2025, 12, 31), "Termination", 50_000m, 0, 0,
            53_919.68m, null, null, 0, 0, p.Brackets, p.StampTaxRate));
        Assert.Equal(365, r.TenureDays);
        Assert.True(r.SeveranceEligible);
        Assert.Equal(50_000m, r.SeveranceGross);
        Assert.Equal(379.50m, r.SeveranceStampTax);
        Assert.Equal(4, r.NoticeWeeks);
        Assert.Equal(46_666.67m, r.NoticeGross);
        Assert.Equal(7_000.00m, r.NoticeIncomeTax);
        Assert.Equal(354.20m, r.NoticeStampTax);
        Assert.Equal(49_620.50m + 39_312.47m, r.TotalNet);
    }

    [Fact]
    public void Kidem_tavani_giydirilmis_ucrete_uygulanir_ihbara_uygulanmaz()
    {
        var p = PayrollDefaults.For(2026);
        var r = SeveranceCalculator.Compute(new SeveranceInput(new DateOnly(2016, 1, 1), new DateOnly(2025, 12, 31), "Termination", 100_000m, 10_000m, 5_000m,
            64_948.77m, null, null, 10, 0, p.Brackets, p.StampTaxRate));
        Assert.Equal(115_000m, r.DressedMonthlyGross);
        Assert.True(r.CeilingApplied);
        Assert.Equal(64_948.77m, r.SeveranceBasis);
        Assert.Equal(Math.Round(64_948.77m * r.TenureDays / 365m, 2, MidpointRounding.AwayFromZero), r.SeveranceGross);
        Assert.Equal(8, r.NoticeWeeks);
        Assert.Equal(Math.Round(115_000m / 30m * 56, 2, MidpointRounding.AwayFromZero), r.NoticeGross);
        Assert.Equal(Math.Round(100_000m / 30m * 10, 2, MidpointRounding.AwayFromZero), r.UnusedLeaveGross);
    }

    [Theory]
    [InlineData(100, 2)]
    [InlineData(200, 4)]
    [InlineData(600, 6)]
    [InlineData(1200, 8)]
    public void Ihbar_haftalari(int days, int weeks) => Assert.Equal(weeks, SeveranceCalculator.NoticeWeeks(days));

    [Fact]
    public void Istifada_kidem_ve_ihbar_yok_ama_IK_karari_degistirebilir()
    {
        var p = PayrollDefaults.For(2026);
        SeveranceInput I(bool? elig, bool? notice) => new(new DateOnly(2020, 1, 1), new DateOnly(2026, 3, 31), "Resignation", 60_000m, 0, 0, 64_948.77m,
            elig, notice, 0, 100_000m, p.Brackets, p.StampTaxRate);
        var r = SeveranceCalculator.Compute(I(null, null));
        Assert.False(r.SeveranceEligible);
        Assert.Equal(0, r.SeveranceGross);
        Assert.Equal(0, r.NoticeGross);
        var o = SeveranceCalculator.Compute(I(true, null));                   // ör. evlilik nedeniyle fesih: İK kararı
        Assert.True(o.SeveranceEligible);
        Assert.True(o.SeveranceGross > 0);
        Assert.Equal("49.620,50 TL", SeveranceCalculator.Variables(SeveranceCalculator.Compute(new SeveranceInput(new DateOnly(2025, 1, 1),
            new DateOnly(2025, 12, 31), "Termination", 50_000m, 0, 0, 53_919.68m, null, null, 0, 0, p.Brackets, 0.00759m)), new DateOnly(2025, 12, 31), "x")["kidem.net"]);
    }

    /* ------------------------------------------------------------ 63 fark bordrosu */

    [Fact]
    public void Fark_bordrosu_brut_farki_ve_odenen_fark_dusulur()
    {
        var p = PayrollDefaults.For(2026);
        var i = new PayrollInput(3, 50_000m, 0, 0, 0, 0, 100_000m);
        var old = Slip(PayrollCalculator.Calculate(p, i), i, A, Guid.NewGuid(), 2026);
        var c = RetroPay.Compute(p, old, 55_000m, 0)!;
        Assert.Equal(5_000m, c.DiffGross);
        Assert.Equal("Fark: 2026/03", c.Label);
        Assert.True(c.NewNet > c.OldNet);
        Assert.Equal(3_000m, RetroPay.Compute(p, old, 55_000m, 2_000m)!.DiffGross);
        Assert.Null(RetroPay.Compute(p, old, 55_000m, 5_000m));                // tamamı ödenmiş
        Assert.True(RetroPay.Compute(p, old, 45_000m, 0)!.DiffGross < 0);      // geriye dönük indirim: yalnızca gösterilir
    }

    [Fact]
    public void Fark_bordrosu_eksik_gun_ve_fazla_mesaiyi_korur()
    {
        var p = PayrollDefaults.For(2026);
        var i = new PayrollInput(5, 45_000m, 10, 6, 0, 0, 0);
        var old = Slip(PayrollCalculator.Calculate(p, i), i, A, Guid.NewGuid(), 2026);
        var c = RetroPay.Compute(p, old, 54_000m, 0)!;
        // 20 gün: 9.000 x 20/30 = 6.000 + fazla mesai farkı (9.000 / 225 x 1,5 x 6 = 360)
        Assert.Equal(6_360m, c.DiffGross);
    }

    [Fact]
    public void Donem_icin_gecerli_ucret_kaydi()
    {
        var recs = new[]
        {
            new CompensationRecord { EmployeeId = A, BaseSalary = 40_000, EffectiveFrom = new DateOnly(2025, 1, 1), EffectiveTo = new DateOnly(2026, 1, 31) },
            new CompensationRecord { EmployeeId = A, BaseSalary = 50_000, EffectiveFrom = new DateOnly(2026, 2, 1) },
        };
        Assert.Equal(40_000, RetroPay.RecordFor(recs, 2026, 1)!.BaseSalary);
        Assert.Equal(50_000, RetroPay.RecordFor(recs, 2026, 2)!.BaseSalary);
    }

    /* ------------------------------------------------------------ 64 muhasebe fişi */

    [Fact]
    public void Muhasebe_fisi_dengeli_ve_masraf_merkezi_eslenir()
    {
        var p = PayrollDefaults.For(2026);
        var period = new PayrollPeriod { Year = 2026, Month = 2 };
        var inputs = new[] { new PayrollInput(2, 87_654.32m, 3, 7, 1_234.56m, 999.99m, 80_000m), new PayrollInput(2, 33_030m, 0, 0, 0, 0, 0) };
        var slips = inputs.Select((x, k) => Slip(PayrollCalculator.Calculate(p, x), x, k == 0 ? A : B, period.Id, 2026)).ToList();
        var people = new Dictionary<Guid, ExportPerson>
        {
            [A] = new(A, "a", "b", null, null, "Mühendislik", new DateOnly(2020, 1, 1), null),
            [B] = new(B, "c", "d", null, null, "Satış", new DateOnly(2020, 1, 1), null),
        };
        var lines = Exporters.Journal(period, slips, people, new AccountMap(Salary: "770.10"), new Dictionary<string, string> { ["Mühendislik"] = "MM-100" });
        Assert.True(Exporters.JournalBalanced(lines));
        Assert.Equal(0, Exporters.JournalDifference(lines));
        Assert.Contains(lines, l => l.CostCenter == "MM-100" && l.Account == "770.10");
        Assert.Contains(lines, l => l.CostCenter == "Satış");
        var csv = Encoding.UTF8.GetString(Exporters.Accounting(period, slips, people, "mikro", new AccountMap()).Content);
        Assert.Contains(";B\n", csv);
        Assert.False(Exporters.JournalBalanced(lines.Append(new Exporters.JournalLine("1", "x", "y", 1m, 0, "z"))));
    }

    /* ------------------------------------------------------------ 59 e-bordro */

    [Fact]
    public void E_bordro_ozeti_kararli_ve_degisiklige_duyarli()
    {
        var s = new Payslip { Id = A, EmployeeId = B, Year = 2026, Month = 1, Net = 28_075.5m, Gross = 33_030m };
        var h1 = EPayslip.Hash(s);
        Assert.Equal(h1, EPayslip.Hash(new Payslip { Id = A, EmployeeId = B, Year = 2026, Month = 1, Net = 28_075.50m, Gross = 33_030.00m }));
        Assert.Equal(64, h1.Length);
        s.Net += 0.01m;
        Assert.NotEqual(h1, EPayslip.Hash(s));
        Assert.Contains("\"net\":\"28075.51\"", EPayslip.Canonical(s));
        Assert.Equal("10.1.2.0/24", EPayslip.IpPrefix("10.1.2.3"));
        Assert.Null(EPayslip.IpPrefix("x"));
        Assert.EndsWith("::/48", EPayslip.IpPrefix("2001:db8:1234:5678::1"));
    }

    /* ------------------------------------------------------------ 65 bantlar ve compa-ratio */

    [Fact]
    public void Bant_secimi_yururluk_tarihine_ve_para_birimine_gore()
    {
        var bands = new[]
        {
            new SalaryBand { Grade = "L3", Year = 2026, MinAmount = 40_000, MidAmount = 50_000, MaxAmount = 60_000, Currency = "TRY" },
            new SalaryBand { Grade = "L3", Year = 2026, EffectiveFrom = new DateOnly(2026, 7, 1), MinAmount = 45_000, MidAmount = 55_000, MaxAmount = 65_000, Currency = "TRY" },
            new SalaryBand { Grade = "L3", Year = 2026, MinAmount = 1, MidAmount = 2, MaxAmount = 3, Currency = "EUR" },
        };
        Assert.Equal(50_000, CompaRatio.BandFor(bands, "l3", "TRY", new DateOnly(2026, 6, 30))!.MidAmount);
        Assert.Equal(55_000, CompaRatio.BandFor(bands, "L3", "TRY", new DateOnly(2026, 7, 1))!.MidAmount);
        Assert.Null(CompaRatio.BandFor(bands, "L4", "TRY", new DateOnly(2026, 7, 1)));
        var b = bands[0];
        Assert.Equal(1.1m, CompaRatio.Ratio(55_000, b));
        Assert.Equal("below", CompaRatio.Position(39_000, b));
        Assert.Equal("within", CompaRatio.Position(60_000, b));
        Assert.Equal("above", CompaRatio.Position(60_001, b));
        Assert.Equal("none", CompaRatio.Position(1, null));
    }

    [Fact]
    public void Kapsama_raporu_bes_kisiden_kucuk_gruplari_gizler()
    {
        var items = Enumerable.Range(0, 6).Select(k => new CompaRatio.Item("L3 (2026)", "Mühendislik", 1.0m + k / 100m, k == 0 ? "below" : "within"))
            .Concat(Enumerable.Range(0, 3).Select(_ => new CompaRatio.Item("L4 (2026)", "Satış", 1.2m, "above")))
            .Append(new CompaRatio.Item(null, "Satış", null, "none")).ToList();
        var json = JsonSerializer.Serialize(CompaRatio.Coverage(items), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;
        Assert.Equal(10, root.GetProperty("total").GetInt32());
        Assert.Equal(1, root.GetProperty("noBand").GetInt32());
        Assert.Equal(4, root.GetProperty("outsideBand").GetInt32());
        var byBand = root.GetProperty("byBand").EnumerateArray().ToList();
        var l3 = byBand.Single(g => g.GetProperty("key").GetString() == "L3 (2026)");
        Assert.False(l3.GetProperty("hidden").GetBoolean());
        Assert.Equal(1, l3.GetProperty("below").GetInt32());
        var l4 = byBand.Single(g => g.GetProperty("key").GetString() == "L4 (2026)");
        Assert.True(l4.GetProperty("hidden").GetBoolean());
        Assert.Equal(JsonValueKind.Null, l4.GetProperty("above").ValueKind);
        Assert.Equal(JsonValueKind.Null, l4.GetProperty("avgCompaRatio").ValueKind);
    }

    /* ------------------------------------------------------------ ayarlar */

    [Fact]
    public void Ayarlar_bozuk_jsonda_varsayilana_doner_ve_dogrulanir()
    {
        var m = PayrollSettingsModel.From(new PayrollSettings { SgkJson = "{bozuk", AccountMapJson = "{\"salary\":\"770.99\"}", CostCentersJson = "{\"mühendislik\":\"MM1\"}" });
        Assert.Equal("01", m.Sgk.DefaultDocumentType);
        Assert.Equal("770.99", m.Accounts.Salary);
        Assert.Equal("335", m.Accounts.NetPayable);                             // verilmeyen hesap varsayılan
        Assert.Equal("MM1", m.CostCenters["Mühendislik"]);                      // büyük/küçük harf duyarsız
        Assert.Null(PayrollSettingsModel.Validate(new SgkSettings(), new AccountMap(), new(), new BankSettings()));
        Assert.NotNull(PayrollSettingsModel.Validate(new SgkSettings { DefaultLawNo = "55" }, null, null, null));
        Assert.NotNull(PayrollSettingsModel.Validate(new SgkSettings { MissingDayCodes = new() { new("Unpaid", "2a", true) } }, null, null, null));
        Assert.NotNull(PayrollSettingsModel.Validate(null, null, null, new BankSettings { DebitIban = "TR000" }));
    }
}
