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

    public static async Task<Result> RunAsync(Sql sql, string tenant, string question, bool allowPersonLevel, CancellationToken ct)
    {
        var q = Norm(question);
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));

        string? metric =
            Has(q, "fazla mesai", "mesai", "overtime") ? "overtime" :
            Has(q, "izin") ? "leave" :
            Has(q, "ise alim", "ise giren", "yeni calisan", "yeni baslayan", "ise baslayan", "alim") ? "hires" :
            Has(q, "ayrilan", "cikis", "isten ayril", "turnover", "devir") ? "exits" :
            Has(q, "masraf", "harcama") ? "expense" :
            Has(q, "performans", "puan") ? "performance" :
            Has(q, "egitim", "kurs") ? "training" :
            Has(q, "calisan sayisi", "kac kisi", "kac calisan", "kadro", "headcount", "personel sayisi", "calisan") ? "headcount" : null;

        var groupBy =
            Has(q, "departman", "birim", "bolum") ? "department" :
            Has(q, "izin turu", "turlerine", "turune", "tipine", "tur bazinda", "turu") ? "type" :
            Has(q, "en cok", "en fazla", "kisi bazinda", "calisan bazinda", "kimler", "kim ") ? "person" :
            Has(q, "aylik", "aya gore", "aylara", "her ay", "ay ay", "trend", "egilim") ? "month" : "none";
        if (groupBy == "person" && !allowPersonLevel) groupBy = "department";
        if (groupBy == "type" && metric is not ("leave" or "training")) groupBy = "none";

        var (from, to, periodLabel) = ParsePeriod(q, today, groupBy == "month" || metric == "headcount" && groupBy == "month");

        if (metric is null)
            return new Result(false, "Soruyu anlayamadım. İzin, işe alım, ayrılış, çalışan sayısı, fazla mesai, masraf, performans veya eğitim hakkında sorabilirsiniz.",
                "", groupBy, from, to, Array.Empty<string>(), new(), "none", "", Examples);

        var (columns, select, chart, label) = Build(metric, groupBy);
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

        var groupText = groupBy switch
        {
            "department" => "departmanlara göre ", "month" => "aylara göre ", "type" => "türe göre ", "person" => "kişi bazında (ilk 10) ", _ => "",
        };
        var interpretation = metric is "headcount" or "performance" && groupBy != "month"
            ? $"{Capitalize(groupText)}{label} (güncel)"
            : $"{periodLabel} {groupText}{label}";
        return new Result(true, Capitalize(interpretation.Trim()), metric, groupBy, from, to, columns, rows, chart,
            Regex.Replace(select, @"\s+", " ").Trim(), Examples.Where(e => !Norm(e).Contains(metric)).Take(4).ToArray());
    }

    private static (string[] Columns, string Sql, string Chart, string Label) Build(string metric, string groupBy)
    {
        string Group(string valueExpr, string from, string dateExpr, string label, string typeExpr = "NULL")
        {
            return groupBy switch
            {
                "department" => $"SELECT coalesce(d.\"Name\", 'Atanmamış'), {valueExpr} FROM {from} {DeptJoin} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC",
                "month" => $"SELECT date_trunc('month', {dateExpr})::date, {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1",
                "type" => $"SELECT {typeExpr}, {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC",
                "person" => $"SELECT e.\"FirstName\" || ' ' || e.\"LastName\", {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
                _ => $"SELECT '{label}', {valueExpr} FROM {from} WHERE e.\"TenantSlug\" = $1 AND {dateExpr} BETWEEN $2 AND $3",
            };
        }
        string First() => groupBy switch { "department" => "Departman", "month" => "Ay", "type" => "Tür", "person" => "Çalışan", _ => "Ölçüt" };
        var chart = groupBy switch { "month" => "line", "none" => "number", _ => "bar" };

        switch (metric)
        {
            case "leave":
                return (new[] { First(), "İzin günü" }, Group("sum(l.\"Days\")",
                    "leave_requests l JOIN employee_employees e ON e.\"Id\" = l.\"EmployeeId\" AND l.\"Status\" = 'Approved'",
                    "l.\"StartDate\"", "onaylı izin günü", "l.\"Type\""), chart, "onaylı izin günleri");
            case "overtime":
                return (new[] { First(), "Fazla mesai (saat)" }, Group("round(sum(t.\"OvertimeMinutes\") / 60.0, 1)",
                    "timeshift_time_entries t JOIN employee_employees e ON e.\"Id\" = t.\"EmployeeId\"", "t.\"Date\"", "fazla mesai saati"), chart, "fazla mesai saatleri");
            case "expense":
                return (new[] { First(), "Tutar" }, Group("sum(c.\"TotalAmount\")",
                    "expense_claims c JOIN employee_employees e ON e.\"Id\" = c.\"EmployeeId\" AND c.\"Status\" IN ('Approved','Paid')",
                    "coalesce(c.\"SubmittedAt\", c.\"CreatedAt\")::date", "masraf toplamı"), chart, "onaylı masraf toplamı");
            case "hires":
                return (new[] { First(), "İşe alım" }, Group("count(*)", "employee_employees e", "e.\"HireDate\"", "işe alım"), chart, "işe alım sayısı");
            case "exits":
                return (new[] { First(), "Ayrılış" }, Group("count(*)", "employee_employees e", $"({ExitDate})", "ayrılış"), chart, "ayrılan çalışan sayısı");
            case "training":
                return (new[] { First(), "Tamamlanan eğitim" }, Group("count(*)",
                    "learning_enrollments n JOIN employee_employees e ON e.\"Id\" = n.\"EmployeeId\" AND n.\"Status\" = 'Completed' JOIN learning_courses co ON co.\"Id\" = n.\"CourseId\"",
                    "n.\"CompletedAt\"::date", "tamamlanan eğitim", "co.\"Category\""), chart, "tamamlanan eğitimler");
            case "performance":
                var perf = groupBy switch
                {
                    "person" => "SELECT e.\"FirstName\" || ' ' || e.\"LastName\", round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s JOIN employee_employees e ON e.\"Id\" = s.\"EmployeeId\" WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10",
                    "month" => "SELECT date_trunc('month', s.\"CapturedAt\")::date, round(avg(s.\"Score\"), 1) FROM performance_snapshots s WHERE s.\"TenantSlug\" = $1 AND s.\"CapturedAt\"::date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 1",
                    "department" => $"SELECT coalesce(d.\"Name\", 'Atanmamış'), round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s JOIN employee_employees e ON e.\"Id\" = s.\"EmployeeId\" {DeptJoin} WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
                    _ => "SELECT 'Ortalama puan', round(avg(s.\"Score\"), 1) FROM (SELECT DISTINCT ON (\"EmployeeId\") * FROM performance_snapshots WHERE \"TenantSlug\" = $1 ORDER BY \"EmployeeId\", \"CapturedAt\" DESC) s WHERE $2::date IS NOT NULL AND $3::date IS NOT NULL",
                };
                return (new[] { First(), "Ortalama puan" }, perf, chart, "ortalama performans puanı");
            default: // headcount
                var hc = groupBy switch
                {
                    "month" => $"SELECT m::date, (SELECT count(*) FROM employee_employees e WHERE e.\"TenantSlug\" = $1 AND e.\"HireDate\" <= (m + interval '1 month - 1 day')::date AND coalesce({ExitDate}, '9999-12-31'::date) >= (m + interval '1 month - 1 day')::date) FROM generate_series(date_trunc('month', $2::date), date_trunc('month', $3::date), interval '1 month') m ORDER BY 1",
                    "department" or "person" => $"SELECT coalesce(d.\"Name\", 'Atanmamış'), count(*) FROM employee_employees e {DeptJoin} WHERE e.\"TenantSlug\" = $1 AND e.\"Status\" <> 'Terminated' AND $2::date IS NOT NULL AND $3::date IS NOT NULL GROUP BY 1 ORDER BY 2 DESC",
                    _ => "SELECT 'Aktif çalışan', count(*) FROM employee_employees e WHERE e.\"TenantSlug\" = $1 AND e.\"Status\" <> 'Terminated' AND $2::date IS NOT NULL AND $3::date IS NOT NULL",
                };
                return (new[] { groupBy == "person" ? "Departman" : First(), "Çalışan" }, hc, groupBy == "person" ? "bar" : chart, "çalışan sayısı");
        }
    }

    private static (DateOnly From, DateOnly To, string Label) ParsePeriod(string q, DateOnly today, bool monthly)
    {
        var m = Regex.Match(q, @"son\s+(\d{1,3})\s*(gun|hafta|ay|yil)");
        if (m.Success)
        {
            var n = int.Parse(m.Groups[1].Value);
            var from = m.Groups[2].Value switch
            {
                "gun" => today.AddDays(-n), "hafta" => today.AddDays(-7 * n), "yil" => today.AddYears(-n), _ => today.AddMonths(-n),
            };
            var unit = m.Groups[2].Value switch { "gun" => "günde", "hafta" => "haftada", "yil" => "yılda", _ => "ayda" };
            return (from, today, $"Son {n} {unit}");
        }
        if (q.Contains("gecen ay")) { var f = new DateOnly(today.Year, today.Month, 1).AddMonths(-1); return (f, f.AddMonths(1).AddDays(-1), "Geçen ay"); }
        if (q.Contains("bu ay")) return (new DateOnly(today.Year, today.Month, 1), today, "Bu ay");
        if (q.Contains("gecen yil") || q.Contains("gecen sene")) return (new DateOnly(today.Year - 1, 1, 1), new DateOnly(today.Year - 1, 12, 31), "Geçen yıl");
        if (q.Contains("bu hafta")) return (today.AddDays(-(((int)today.DayOfWeek + 6) % 7)), today, "Bu hafta");
        if (q.Contains("bugun")) return (today, today, "Bugün");

        var year = Regex.Match(q, @"\b(20\d{2})\b");
        for (var i = 0; i < Months.Length; i++)
        {
            if (!Regex.IsMatch(q, $@"\b{Months[i]}")) continue;
            var y = year.Success ? int.Parse(year.Value) : (i + 1 > today.Month ? today.Year - 1 : today.Year);
            var f = new DateOnly(y, i + 1, 1);
            return (f, f.AddMonths(1).AddDays(-1), $"{CultureInfo.GetCultureInfo("tr-TR").DateTimeFormat.GetMonthName(i + 1)} {y}");
        }
        if (year.Success) { var y = int.Parse(year.Value); return (new DateOnly(y, 1, 1), new DateOnly(y, 12, 31), $"{y} yılında"); }
        if (q.Contains("bu yil") || q.Contains("bu sene")) return (new DateOnly(today.Year, 1, 1), today, "Bu yıl");
        return monthly ? (today.AddMonths(-11), today, "Son 12 ayda") : (today.AddMonths(-12), today, "Son 12 ayda");
    }

    private static bool Has(string q, params string[] words) => words.Any(q.Contains);
    private static string Capitalize(string s) => s.Length == 0 ? s : char.ToUpper(s[0], new CultureInfo("tr-TR")) + s[1..];
}
