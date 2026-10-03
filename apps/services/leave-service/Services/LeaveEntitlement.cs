namespace LeaveService.Services;

/// <summary>
/// Yasal yıllık ücretli izin süresi (4857 sayılı İş Kanunu m.53):
///   hizmet süresi 1-5 yıl (5 dahil) → en az 14 gün; 5-15 yıl → 20 gün; 15 yıl ve fazlası → 26 gün;
///   18 yaş ve altı ile 50 yaş ve üstü çalışanlara en az 20 gün.
/// Hak, işe giriş yıl dönümünde doğar. KVKK: doğum tarihi yalnızca yaş kuralı için kullanılır,
/// yanıtta gösterilmez.
/// </summary>
public static class LeaveEntitlement
{
    /// <summary>Günlük çalışma saati (saatlik izni güne çevirmek için). LEAVE_DAY_HOURS, varsayılan 7,5.</summary>
    public static decimal DayHours =>
        decimal.TryParse(Environment.GetEnvironmentVariable("LEAVE_DAY_HOURS"), System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out var h) && h is > 0 and <= 12 ? h : 7.5m;

    public static DateOnly Anniversary(DateOnly hire, int year)
    {
        var y = Math.Max(year, hire.Year);
        // 29 Şubat'ta işe girenin yıl dönümü artık olmayan yılda 28 Şubat'tır.
        return hire.Month == 2 && hire.Day == 29 && !DateTime.IsLeapYear(y) ? new DateOnly(y, 2, 28) : new DateOnly(y, hire.Month, hire.Day);
    }

    public static int ServiceYears(DateOnly hire, int year) => Math.Max(0, year - hire.Year);

    public static int AgeAt(DateOnly birth, DateOnly on)
    {
        var age = on.Year - birth.Year;
        if (on < birth.AddYears(age)) age--;
        return age;
    }

    /// <summary>Verilen yılda (yıl dönümünde) doğan yasal izin günü; 1 yılı doldurmamışsa 0.</summary>
    public static (int Days, int ServiceYears, bool AgeRule) Statutory(DateOnly hire, DateOnly? birth, int year)
    {
        var years = ServiceYears(hire, year);
        if (years < 1) return (0, years, false);
        var days = years <= 5 ? 14 : years < 15 ? 20 : 26;
        var ageRule = false;
        if (birth is { } b)
        {
            var age = AgeAt(b, Anniversary(hire, year));
            if ((age <= 18 || age >= 50) && days < 20) { days = 20; ageRule = true; }
        }
        return (days, years, ageRule);
    }

    /// <summary>Saatlik izin → gün (2 ondalık).</summary>
    public static decimal HoursToDays(decimal hours) => Math.Round(hours / DayHours, 2, MidpointRounding.AwayFromZero);
}
