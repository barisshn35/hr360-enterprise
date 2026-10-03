using System.Globalization;
using System.Text.RegularExpressions;

namespace GovernanceService.Infrastructure;

/// <summary>
/// Doğal dilde rapor: "geçen ay departmanlara göre izin günleri" gibi Türkçe bir
/// soruyu ölçüt + kırılım + zaman aralığına ayrıştırır ve önceden yazılmış,
/// parametreli SQL şablonlarından birini çalıştırır.
///
/// DÜRÜSTLÜK NOTU: Bu bir dil modeli DEĞİLDİR. Kural tabanlı bir ayrıştırıcıdır;
/// anlamadığı soruda tahmin yürütmez, "anlamadım" der ve örnek sorular önerir.
/// Avantajı: SQL serbest üretilmez (enjeksiyon yok), her yanıtla birlikte
/// nasıl yorumlandığı ve çalıştırılan sorgu gösterilir, kiracı filtresi her
/// şablonda sabittir.
/// </summary>
public static class NlReport
{
    public sealed record Result(
        bool Understood, string Interpretation, string Metric, string GroupBy, DateOnly From, DateOnly To,
        string[] Columns, List<object?[]> Rows, string Chart, string Sql, string[] Suggestions);

    public static string[] ExamplesFor(string lang) => lang == "en" ? ExamplesEn : Examples;

    public static readonly string[] ExamplesEn =
    {
        "Leave days by department in the last 6 months",
        "Monthly hires this year",
        "Employees with the most overtime last month",
        "Headcount by department",
        "Monthly headcount in the last 12 months",
        "Leave by type this year",
        "Number of leavers last year",
        "Average performance score by department",
        "Monthly expense total this year",
    };

    public static readonly string[] Examples =
    {
        "Son 6 ayda departmanlara göre izin günleri",
        "Bu yıl aylık işe alım sayısı",
        "Geçen ay en çok fazla mesai yapan çalışanlar",
        "Departmanlara göre çalışan sayısı",
        "Son 12 ayda aylık çalışan sayısı",
        "Bu yıl izin türlerine göre dağılım",
        "Geçen yıl ayrılan çalışan sayısı",
        "Departmanlara göre ortalama performans puanı",
        "Bu yıl aylık masraf toplamı",
    };

    private static readonly string[] Months = { "ocak", "subat", "mart", "nisan", "mayis", "haziran", "temmuz", "agustos", "eylul", "ekim", "kasim", "aralik" };

    public static string Norm(string s)
    {
        var lower = s.ToLower(new CultureInfo("tr-TR"));
        var map = new Dictionary<char, char> { ['ı'] = 'i', ['ş'] = 's', ['ğ'] = 'g', ['ü'] = 'u', ['ö'] = 'o', ['ç'] = 'c', ['â'] = 'a', ['î'] = 'i' };
        return new string(lower.Select(c => map.TryGetValue(c, out var r) ? r : c).ToArray());
    }

    private const string DeptJoin = """
        LEFT JOIN LATERAL (SELECT x."DepartmentId" FROM employee_assignments x WHERE x."EmployeeId" = e."Id"
            AND x."EffectiveFrom" <= current_date AND (x."EffectiveTo" IS NULL OR x."EffectiveTo" >= current_date)
            ORDER BY x."EffectiveFrom" DESC LIMIT 1) asg ON true
        LEFT JOIN organization_departments d ON d."Id" = asg."DepartmentId"
        """;

    private const string ExitDate = """
        CASE WHEN e."Status" = 'Terminated' THEN coalesce((SELECT max(a."EffectiveTo") FROM employee_assignments a WHERE a."EmployeeId" = e."Id"), e."CreatedAt"::date) END
        """;

    /// <summary>
    /// Soru Türkçe ya da İngilizce olabilir; iki dilin anahtar sözcükleri birlikte aranır.
    /// <paramref name="lang"/> yalnızca yanıtın (yorum, sütun adları, örnekler) dilini belirler.
    /// </summary>
    public static async Task<Result> RunAsync(Sql sql, string tenant, string question, bool allowPersonLevel, CancellationToken ct, string lang = "tr")
    {
        var en = lang == "en";
        string L(string tr, string e) => en ? e : tr;
        var q = " " + Norm(question) + " ";
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));

        // Sıra önemli: "leavers" içinde "leave", "new employees" içinde "employees" geçer.
        string? metric =
            Has(q, "fazla mesai", "mesai", "overtime", "extra hours") ? "overtime" :
            Has(q, "leaver", " left ", "attrition", "turnover", "resign", "termination", " exits", " exit ") ? "exits" :
            Has(q, "izin", " leave", "time off", "vacation", "absence") ? "leave" :
            Has(q, "ise alim", "ise giren", "yeni calisan", "yeni baslayan", "ise baslayan", "alim", " hire", "hiring", "new employee", "joiner", "new starter") ? "hires" :
            Has(q, "ayrilan", "cikis", "isten ayril", "devir") ? "exits" :
            Has(q, "masraf", "harcama", "expense", "spend") ? "expense" :
            Has(q, "performans", "puan", "performance", "score", "rating") ? "performance" :
            Has(q, "egitim", "kurs", "training", "course") ? "training" :
            Has(q, "calisan sayisi", "kac kisi", "kac calisan", "kadro", "headcount", "personel sayisi", "calisan",
                "employee count", "number of employees", "how many employees", "staff", "employees") ? "headcount" : null;

        var groupBy =
            Has(q, "departman", "birim", "bolum", "department") ? "department" :
            Has(q, "izin turu", "turlerine", "turune", "tipine", "tur bazinda", "turu", "by type", "per type", "leave type", " types") ? "type" :
            Has(q, "en cok", "en fazla", "kisi bazinda", "calisan bazinda", "kimler", " kim ", " most ", " top ", "per person", "by employee", " who ") ? "person" :
            Has(q, "aylik", "aya gore", "aylara", "her ay", "ay ay", "trend", "egilim", "monthly", "by month", "per month", "each month", "over time") ? "month" : "none";
        if (groupBy == "person" && !allowPersonLevel) groupBy = "department";
        if (groupBy == "type" && metric is not ("leave" or "training")) groupBy = "none";

        var (from, to, periodLabel) = ParsePeriod(q, today, groupBy == "month" || metric == "headcount" && groupBy == "month", en);

        if (metric is null)
            return new Result(false, L("Soruyu anlayamadım. İzin, işe alım, ayrılış, çalışan sayısı, fazla mesai, masraf, performans veya eğitim hakkında sorabilirsiniz.",
                    "I couldn't understand the question. You can ask about leave, hiring, leavers, headcount, overtime, expenses, performance or training."),
                "", groupBy, from, to, Array.Empty<string>(), new(), "none", "", ExamplesFor(lang));

        var (columns, select, chart, label) = Build(metric, groupBy, en);
        var rows = await sql.QueryAsync(select, r =>
        {
            var arr = new object?[r.FieldCount];
            for (var i = 0; i < r.FieldCount; i++)
                arr[i] = r.IsDBNull(i) ? null : r.GetValue(i) switch
                {
                    DateOnly d => d.ToString("yyyy-MM"),
                    DateTime dt => dt.ToString("yyyy-MM"),
                    decimal m => Math.Round(m, 1),
                    double db => Math.Round(db, 1),
                    var v => v,
                };
            return arr;
        }, ct, tenant, from, to);

        string interpretation;
        if (en)
        {
            var by = groupBy switch { "department" => " by department", "month" => " by month", "type" => " by type", "person" => " per person (top 10)", _ => "" };
            interpretation = metric is "headcount" or "performance" && groupBy != "month"
                ? $"{label}{by} (current)"
                : $"{label}{by}, {periodLabel}";
        }
        else
        {
            var groupText = groupBy switch
            {
                "department" => "departmanlara göre ", "month" => "aylara göre ", "type" => "türe göre ", "person" => "kişi bazında (ilk 10) ", _ => "",
            };
            interpretation = metric is "headcount" or "performance" && groupBy != "month"
                ? $"{Capitalize(groupText)}{label} (güncel)"
                : $"{periodLabel} {groupText}{label}";
        }
        var examples = ExamplesFor(lang);
        return new Result(true, Capitalize(interpretation.Trim(), en), metric, groupBy, from, to, columns, rows, chart,
            Regex.Replace(select, @"\s+", " ").Trim(), examples.Where(e => !Norm(e).Contains(metric)).Take(4).ToArray());
    }

    private static (string[] Columns, string Sql, string Chart, string Label) Build(string metric, string groupBy, bool en = false)
    {
        string L(string tr, string e) => en ? e : tr;
        var unassigned = L("Atanmamış", "Unassigned");
        string Group(string valueExpr, string from, string dateExpr, string label, string typeExpr = "NULL")
        {
            return groupBy switch
            {
                "department" => $"SELECT coalesce(d.\"Name\", '{unassigned}'), {valueExpr} FROM {from} {DeptJoin} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC",
                "month" => $"SELECT date_trunc('month', {dateExpr})::date, {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1",
                "type" => $"SELECT {typeExpr}, {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC",
                "person" => $"SELECT e.\"FirstName\" || ' ' || e.\"LastName\", {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
                _ => $"SELECT '{label}', {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3",
            };
        }
        string First() => groupBy switch { "department" => L("Departman", "Department"), "month" => L("Ay", "Month"), "type" => L("Tür", "Type"), "person" => L("Çalışan", "Employee"), _ => L("Ölçüt", "Measure") };
        var chart = groupBy switch { "month" => "line", "none" => "number", _ => "bar" };

        switch (metric)
        {
            case "leave":
                return (new[] { First(), L("İzin günü", "Leave days") }, Group("sum(l.\"Days\")",
                    "leave_requests l JOIN employee_employees e ON e.\"Id\" = l.\"EmployeeId\" AND l.\"Status\" = 'Approved'",
                    "l.\"StartDate\"", L("onaylı izin günü", "Approved leave days"), "l.\"Type\""), chart, L("onaylı izin günleri", "approved leave days"));
            case "overtime":
                return (new[] { First(), L("Fazla mesai (saat)", "Overtime (hours)") }, Group("round(sum(t.\"OvertimeMinutes\") / 60.0, 1)",
                    "timeshift_time_entries t JOIN employee_employees e ON e.\"Id\" = t.\"EmployeeId\"", "t.\"Date\"", L("fazla mesai saati", "Overtime hours")), chart, L("fazla mesai saatleri", "overtime hours"));
            case "expense":
                return (new[] { First(), L("Tutar", "Amount") }, Group("sum(c.\"TotalAmount\")",
                    "expense_claims c JOIN employee_employees e ON e.\"Id\" = c.\"EmployeeId\" AND c.\"Status\" IN ('Approved','Paid')",
                    "coalesce(c.\"SubmittedAt\", c.\"CreatedAt\")::date", L("masraf toplamı", "Expense total")), chart, L("onaylı masraf toplamı", "approved expense total"));
            case "hires":
                return (new[] { First(), L("İşe alım", "Hires") }, Group("count(*)", "employee_employees e", "e.\"HireDate\"", L("işe alım", "Hires")), chart, L("işe alım sayısı", "number of hires"));
            case "exits":
                return (new[] { First(), L("Ayrılış", "Leavers") }, Group("count(*)", "employee_employees e", $"({ExitDate})", L("ayrılış", "Leavers")), chart, L("ayrılan çalışan sayısı", "number of leavers"));
            case "training":
                return (new[] { First(), L("Tamamlanan eğitim", "Completed trainings") }, Group("count(*)",
                    "learning_enrollments n JOIN employee_employees e ON e.\"Id\" = n.\"EmployeeId\" AND n.\"Status\" = 'Completed' JOIN learning_courses co ON co.\"Id\" = n.\"CourseId\"",
                    "n.\"CompletedAt\"::date", L("tamamlanan eğitim", "Completed trainings"), "co.\"Category\""), chart, L("tamamlanan eğitimler", "completed trainings"));
            case "performance":
                var perf = groupBy switch
                {
                    "person" => "SELECT e.\"FirstName\" || ' ' || e.\"LastName\", round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s JOIN employee_employees e ON e.\"Id\" = s.\"EmployeeId\" WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
                    "month" => "SELECT date_trunc('month', s.\"CapturedAt\")::date, round(avg(s.\"Score\"), 1) FROM performance_snapshots s WHERE s.\"TenantSlug\" = $1 AND s.\"CapturedAt\"::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1",
                    "department" => $"SELECT coalesce(d.\"Name\", '{unassigned}'), round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s JOIN employee_employees e ON e.\"Id\" = s.\"EmployeeId\" {DeptJoin} WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
                    _ => $"SELECT '{L("Ortalama puan", "Average score")}', round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL",
                };
                return (new[] { First(), L("Ortalama puan", "Average score") }, perf, chart, L("ortalama performans puanı", "average performance score"));
            default: // headcount
                var hc = groupBy switch
                {
                    "month" => $"SELECT m::date, (SELECT count(*) FROM employee_employees e WHERE e.\"TenantSlug\" = $1 AND e.\"HireDate\" <= (m + interval '1 month - 1 day')::date AND coalesce({ExitDate}, '9999-12-31'::date) >= (m + interval '1 month - 1 day')::date) FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') m ORDER BY 1",
                    "department" or "person" => $"SELECT coalesce(d.\"Name\", '{unassigned}'), count(*) FROM employee_employees e {DeptJoin} WHERE e.\"TenantSlug\" = $1 AND e.\"Status\" <> 'Terminated' AND $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
                    _ => $"SELECT '{L("Aktif çalışan", "Active employees")}', count(*) FROM employee_employees e WHERE e.\"TenantSlug\" = $1 AND e.\"Status\" <> 'Terminated' AND $2::date IS NOT NULL AND $3::date IS NOT NULL",
                };
                return (new[] { groupBy == "person" ? L("Departman", "Department") : First(), L("Çalışan", "Employees") }, hc, groupBy == "person" ? "bar" : chart, L("çalışan sayısı", "headcount"));
        }
    }

    private static readonly string[] MonthsEn = { "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december" };

    private static (DateOnly From, DateOnly To, string Label) ParsePeriod(string q, DateOnly today, bool monthly, bool en = false)
    {
        string L(string tr, string e) => en ? e : tr;
        var m = Regex.Match(q, @"son\s+(\d{1,3})\s*(gun|hafta|ay|yil)");
        if (m.Success)
        {
            var n = int.Parse(m.Groups[1].Value);
            return Last(n, m.Groups[2].Value switch { "gun" => "d", "hafta" => "w", "yil" => "y", _ => "m" });
        }
        m = Regex.Match(q, @"(?:last|past)\s+(\d{1,3})\s*(day|week|month|year)s?");
        if (m.Success)
            return Last(int.Parse(m.Groups[1].Value), m.Groups[2].Value[..1]);

        (DateOnly, DateOnly, string) Last(int n, string unit)
        {
            var from = unit switch { "d" => today.AddDays(-n), "w" => today.AddDays(-7 * n), "y" => today.AddYears(-n), _ => today.AddMonths(-n) };
            var trUnit = unit switch { "d" => "günde", "w" => "haftada", "y" => "yılda", _ => "ayda" };
            var enUnit = unit switch { "d" => "day", "w" => "week", "y" => "year", _ => "month" } + (n == 1 ? "" : "s");
            return (from, today, L($"Son {n} {trUnit}", $"last {n} {enUnit}"));
        }

        if (Has(q, "gecen ay", "last month")) { var f = new DateOnly(today.Year, today.Month, 1).AddMonths(-1); return (f, f.AddMonths(1).AddDays(-1), L("Geçen ay", "last month")); }
        if (Has(q, "bu ay", "this month")) return (new DateOnly(today.Year, today.Month, 1), today, L("Bu ay", "this month"));
        if (Has(q, "gecen yil", "gecen sene", "last year")) return (new DateOnly(today.Year - 1, 1, 1), new DateOnly(today.Year - 1, 12, 31), L("Geçen yıl", "last year"));
        if (Has(q, "bu hafta", "this week")) return (today.AddDays(-(((int)today.DayOfWeek + 6) % 7)), today, L("Bu hafta", "this week"));
        if (Has(q, "bugun", "today")) return (today, today, L("Bugün", "today"));

        var year = Regex.Match(q, @"\b(20\d{2})\b");
        for (var i = 0; i < 12; i++)
        {
            if (!Regex.IsMatch(q, $@"\b{Months[i]}") && !Regex.IsMatch(q, $@"\b{MonthsEn[i]}\b")) continue;
            var y = year.Success ? int.Parse(year.Value) : (i + 1 > today.Month ? today.Year - 1 : today.Year);
            var f = new DateOnly(y, i + 1, 1);
            var name = CultureInfo.GetCultureInfo(en ? "en-GB" : "tr-TR").DateTimeFormat.GetMonthName(i + 1);
            return (f, f.AddMonths(1).AddDays(-1), en ? $"in {name} {y}" : $"{name} {y}");
        }
        if (year.Success) { var y = int.Parse(year.Value); return (new DateOnly(y, 1, 1), new DateOnly(y, 12, 31), L($"{y} yılında", $"in {y}")); }
        if (Has(q, "bu yil", "bu sene", "this year")) return (new DateOnly(today.Year, 1, 1), today, L("Bu yıl", "this year"));
        return monthly ? (today.AddMonths(-11), today, L("Son 12 ayda", "last 12 months")) : (today.AddMonths(-12), today, L("Son 12 ayda", "last 12 months"));
    }

    private static bool Has(string q, params string[] words) => words.Any(q.Contains);
    private static string Capitalize(string s, bool en = false) =>
        s.Length == 0 ? s : char.ToUpper(s[0], en ? CultureInfo.InvariantCulture : new CultureInfo("tr-TR")) + s[1..];
}
