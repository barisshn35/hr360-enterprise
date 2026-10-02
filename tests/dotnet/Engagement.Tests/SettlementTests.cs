using EngagementService.Infrastructure;
using Xunit;

namespace Engagement.Tests;

/// <summary>İşten ayrılış hak ediş hesabı (4857 s. İş Kanunu m.17, 1475 s. m.14, 4857 m.59).</summary>
public class SettlementTests
{
    private const decimal Ceiling = 73_729.87m;

    [Theory]
    [InlineData(0.3, 2)]
    [InlineData(0.5, 4)]
    [InlineData(1.49, 4)]
    [InlineData(1.5, 6)]
    [InlineData(2.99, 6)]
    [InlineData(3, 8)]
    [InlineData(15, 8)]
    public void Ihbar_sureleri(double years, int weeks) => Assert.Equal(weeks, SettlementCalculator.NoticeWeeks((decimal)years));

    [Theory]
    [InlineData(0.9, "Termination", false)]          // 1 yıldan az
    [InlineData(1.0, "Termination", true)]
    [InlineData(5, "Resignation", false)]             // istifa: hak yok
    [InlineData(5, "Retirement", true)]
    [InlineData(5, "ContractEnd", true)]
    public void Kidem_hakki(double years, string reason, bool eligible) =>
        Assert.Equal(eligible, SettlementCalculator.SeveranceEligible((decimal)years, reason));

    [Fact]
    public void Isveren_feshi_tam_hesap()
    {
        // 4 yıl (1461 gün) kıdem, brüt 60.000 (tavan altında), 10 gün kullanılmayan izin
        var r = SettlementCalculator.Compute(new DateOnly(2022, 1, 1), new DateOnly(2026, 1, 1), "Termination", 60_000m, 10, Ceiling);
        Assert.Equal(4m, r.TenureYears);
        Assert.True(r.SeveranceEligible);
        Assert.Equal(240_000m, r.Severance);                          // 60.000 × 4 yıl
        Assert.Equal(Math.Round(240_000m * 0.00759m, 2), r.SeveranceStampTax);
        Assert.Equal(8, r.NoticeWeeks);
        Assert.Equal(112_000m, r.Notice);                             // 2.000/gün × 56 gün
        Assert.Equal(20_000m, r.LeavePay);                            // 2.000/gün × 10 gün
        Assert.Equal(r.Severance + r.Notice + r.LeavePay, r.TotalGross);
    }

    [Fact]
    public void Kidem_tavani_uygulanir_ihbar_tavansizdir()
    {
        var r = SettlementCalculator.Compute(new DateOnly(2016, 1, 1), new DateOnly(2026, 1, 1), "Termination", 150_000m, 0, Ceiling);
        Assert.Equal(Math.Round(Ceiling * (3653 / 365.25m), 2), r.Severance);                // brüt 150.000 değil tavan
        Assert.Equal(Math.Round(150_000m / 30m * 56, 2), r.Notice);
    }

    [Fact]
    public void Istifada_ihbar_ve_kidem_yok_izin_ucreti_var()
    {
        var r = SettlementCalculator.Compute(new DateOnly(2020, 1, 1), new DateOnly(2026, 1, 1), "Resignation", 45_000m, 6, Ceiling);
        Assert.Equal(0, r.Severance);
        Assert.False(r.NoticeApplies);
        Assert.Equal(0, r.Notice);
        Assert.Equal(9_000m, r.LeavePay);
    }

    [Fact]
    public void Maas_bilinmiyorsa_tutarlar_sifir_ve_negatif_izin_yok_sayilir()
    {
        var r = SettlementCalculator.Compute(new DateOnly(2020, 1, 1), new DateOnly(2026, 1, 1), "Termination", null, -3, Ceiling);
        Assert.Equal(0, r.TotalGross);
        Assert.True(r.SeveranceEligible);
    }
}
