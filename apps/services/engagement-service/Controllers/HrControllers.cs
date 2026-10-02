using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EngagementService.Data;
using EngagementService.Infrastructure;
using EngagementService.Models;

namespace EngagementService.Controllers;

/* ======================================================================
 * Anket ve eNPS. Anonim anketlerde yanıt, kişiyle eşleştirilemeyen bir
 * anahtarla (sha256) saklanır; departman kırılımı ve serbest metinler
 * yalnızca en az 3 yanıt olduğunda gösterilir (kimlik çıkarımını önler).
 * ==================================================================== */
[Route("api/surveys")]
[Authorize]
public class SurveysController : AppController
{
    public const int AnonymityThreshold = 3;
    private readonly EngagementDbContext _db;
    public SurveysController(EngagementDbContext db) => _db = db;

    private string RespondentKey(Guid surveyId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{Tenant}:{surveyId}:{Me.UserId}:hr360-survey")));

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var q = _db.Surveys.AsNoTracking();
        if (!Me.IsHr) q = q.Where(s => s.Status == "Open");
        var surveys = await q.OrderByDescending(s => s.CreatedAt).ToListAsync(ct);
        var ids = surveys.Select(s => s.Id).ToList();
        var counts = await _db.SurveyResponses.AsNoTracking().Where(r => ids.Contains(r.SurveyId))
            .GroupBy(r => r.SurveyId).Select(g => new { g.Key, n = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.n, ct);
        var myKeys = surveys.Select(s => RespondentKey(s.Id)).ToList();
        var answered = await _db.SurveyResponses.AsNoTracking().Where(r => myKeys.Contains(r.RespondentKey)).Select(r => r.SurveyId).ToListAsync(ct);
        return Ok(surveys.Select(s => new
        {
            s.Id, s.Title, s.Description, s.Kind, s.Questions, s.IsAnonymous, s.Status, s.ClosesAt, s.CreatedByName, s.CreatedAt,
            responseCount = counts.GetValueOrDefault(s.Id), answered = answered.Contains(s.Id),
        }));
    }

    public record SurveyInput(string Title, string? Description, string Kind, List<SurveyQuestion> Questions, bool IsAnonymous, DateTime? ClosesAt);

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create(SurveyInput body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Title) || body.Questions.Count == 0)
            return BadRequest(new { message = "Başlık ve en az bir soru gerekli." });
        if (body.Questions.Any(q => q.Type is not ("Nps" or "Scale" or "Choice" or "Text")))
            return BadRequest(new { message = "Soru tipi Nps, Scale, Choice veya Text olmalı." });
        var s = new Survey
        {
            Title = body.Title.Trim(), Description = body.Description, Kind = body.Kind is "eNPS" or "Pulse" ? body.Kind : "Custom",
            Questions = body.Questions, IsAnonymous = body.IsAnonymous,
            ClosesAt = body.ClosesAt is { } c ? DateTime.SpecifyKind(c, DateTimeKind.Utc) : null, CreatedByName = Me.Name,
        };
        _db.Surveys.Add(s);
        await _db.SaveChangesAsync(ct);
        return Ok(new { s.Id });
    }

    /// <summary>Hazır şablon: eNPS + 4 nabız sorusu + serbest yorum.</summary>
    [HttpPost("templates/{kind:regex(^(enps|pulse)$)}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> FromTemplate(string kind, CancellationToken ct)
    {
        var s = kind == "enps"
            ? new Survey
            {
                Title = $"eNPS — {DateTime.UtcNow.ToString("MMMM yyyy", new System.Globalization.CultureInfo("tr-TR"))}", Kind = "eNPS", IsAnonymous = true, CreatedByName = Me.Name,
                Description = "Kısa, anonim çalışan bağlılığı anketi. Yanıtlarınız kimliğinizle eşleştirilmez.",
                ClosesAt = DateTime.UtcNow.AddDays(14),
                Questions = new()
                {
                    new() { Id = "enps", Text = "Bu şirketi bir arkadaşınıza çalışılacak yer olarak ne kadar önerirsiniz?", Type = "Nps" },
                    new() { Id = "q-manager", Text = "Yöneticimden yeterli destek ve geri bildirim alıyorum.", Type = "Scale" },
                    new() { Id = "q-growth", Text = "Burada öğrenip gelişebildiğimi hissediyorum.", Type = "Scale" },
                    new() { Id = "q-workload", Text = "İş yüküm sürdürülebilir.", Type = "Scale" },
                    new() { Id = "q-recognition", Text = "Yaptığım iş takdir ediliyor.", Type = "Scale" },
                    new() { Id = "q-comment", Text = "Değiştirebilseydiniz ilk neyi değiştirirdiniz?", Type = "Text", Required = false },
                },
            }
            : new Survey
            {
                Title = $"Haftalık nabız — {DateTime.UtcNow:dd.MM}", Kind = "Pulse", IsAnonymous = true, CreatedByName = Me.Name,
                ClosesAt = DateTime.UtcNow.AddDays(5),
                Questions = new()
                {
                    new() { Id = "q-week", Text = "Bu hafta kendinizi nasıl hissettiniz?", Type = "Scale" },
                    new() { Id = "q-block", Text = "İşinizi en çok ne yavaşlattı?", Type = "Choice",
                        Options = new() { "Toplantılar", "Belirsiz öncelikler", "Araç/sistem sorunları", "Bağımlılıklar", "Hiçbiri" } },
                    new() { Id = "q-note", Text = "Eklemek istediğiniz bir şey var mı?", Type = "Text", Required = false },
                },
            };
        _db.Surveys.Add(s);
        await _db.SaveChangesAsync(ct);
        return Ok(new { s.Id });
    }

    public record StatusInput(string Status);

    [HttpPatch("{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> SetStatus(Guid id, StatusInput body, CancellationToken ct)
    {
        var s = await _db.Surveys.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        if (body.Status is not ("Draft" or "Open" or "Closed")) return BadRequest(new { message = "Geçersiz durum." });
        s.Status = body.Status;
        await _db.SaveChangesAsync(ct);
        return Ok(new { s.Status });
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var s = await _db.Surveys.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        _db.Surveys.Remove(s);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    public record ResponseInput(List<SurveyAnswer> Answers);

    [HttpPost("{id:guid}/responses")]
    public async Task<IActionResult> Respond(Guid id, ResponseInput body, CancellationToken ct)
    {
        var s = await _db.Surveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        if (s.Status != "Open" || (s.ClosesAt is { } c && c < DateTime.UtcNow))
            return BadRequest(new { message = "Anket yanıta kapalı." });
        var key = RespondentKey(id);
        if (await _db.SurveyResponses.AnyAsync(r => r.RespondentKey == key && r.SurveyId == id, ct))
            return Conflict(new { message = "Bu ankete zaten yanıt verdiniz." });

        var answers = new List<SurveyAnswer>();
        foreach (var q in s.Questions)
        {
            var a = body.Answers.FirstOrDefault(x => x.QuestionId == q.Id);
            var ok = q.Type switch
            {
                "Nps" => a?.Score is >= 0 and <= 10,
                "Scale" => a?.Score is >= 1 and <= 5,
                "Choice" => a?.Choice is { } ch && q.Options.Contains(ch),
                _ => !string.IsNullOrWhiteSpace(a?.Text),
            };
            if (!ok && q.Required) return BadRequest(new { message = $"Yanıtlanmamış soru: {q.Text}" });
            if (ok) answers.Add(new SurveyAnswer { QuestionId = q.Id, Score = a!.Score, Choice = a.Choice, Text = a.Text?.Trim() is { Length: > 0 } t ? t[..Math.Min(t.Length, 2000)] : null });
        }
        var me = await MyPersonAsync(ct);
        _db.SurveyResponses.Add(new SurveyResponse { SurveyId = id, RespondentKey = key, DepartmentName = me?.Department, Answers = answers });
        await _db.SaveChangesAsync(ct);
        return Ok(new { ok = true });
    }

    [HttpGet("{id:guid}/results")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Results(Guid id, CancellationToken ct)
    {
        var s = await _db.Surveys.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        var responses = await _db.SurveyResponses.AsNoTracking().Where(r => r.SurveyId == id).ToListAsync(ct);
        var n = responses.Count;
        var eligible = (await People.ListAsync(Tenant, ct)).Count;

        object Summarize(SurveyQuestion q, IEnumerable<SurveyResponse> rs)
        {
            var ans = rs.SelectMany(r => r.Answers).Where(a => a.QuestionId == q.Id).ToList();
            switch (q.Type)
            {
                case "Nps":
                    var scores = ans.Where(a => a.Score is not null).Select(a => a.Score!.Value).ToList();
                    var promoters = scores.Count(x => x >= 9);
                    var detractors = scores.Count(x => x <= 6);
                    return new
                    {
                        q.Id, q.Text, q.Type, count = scores.Count,
                        enps = scores.Count == 0 ? (int?)null : (int)Math.Round(100.0 * (promoters - detractors) / scores.Count),
                        promoters, passives = scores.Count - promoters - detractors, detractors,
                        distribution = Enumerable.Range(0, 11).Select(i => scores.Count(x => x == i)),
                    };
                case "Scale":
                    var sc = ans.Where(a => a.Score is not null).Select(a => a.Score!.Value).ToList();
                    return new
                    {
                        q.Id, q.Text, q.Type, count = sc.Count, average = sc.Count == 0 ? (double?)null : Math.Round(sc.Average(), 2),
                        favorable = sc.Count == 0 ? (int?)null : (int)Math.Round(100.0 * sc.Count(x => x >= 4) / sc.Count),
                        distribution = Enumerable.Range(1, 5).Select(i => sc.Count(x => x == i)),
                    };
                case "Choice":
                    return new { q.Id, q.Text, q.Type, count = ans.Count, options = q.Options.Select(o => new { option = o, count = ans.Count(a => a.Choice == o) }) };
                default:
                    var texts = ans.Where(a => a.Text != null).Select(a => a.Text!).OrderBy(_ => Random.Shared.Next()).ToList();
                    return new { q.Id, q.Text, q.Type, count = texts.Count, texts = texts.Count >= AnonymityThreshold || !s.IsAnonymous ? texts : new List<string>(), hiddenForAnonymity = s.IsAnonymous && texts.Count is > 0 and < AnonymityThreshold };
            }
        }

        var byDept = responses.GroupBy(r => r.DepartmentName ?? "Belirtilmemiş")
            .Select(g => new
            {
                department = g.Key, count = g.Count(),
                hidden = g.Count() < AnonymityThreshold,
                enps = g.Count() < AnonymityThreshold ? null : EnpsOf(s, g),
                favorable = g.Count() < AnonymityThreshold ? null : FavorableOf(s, g),
            }).OrderByDescending(x => x.count);

        return Ok(new
        {
            survey = new { s.Id, s.Title, s.Kind, s.Status, s.IsAnonymous, s.ClosesAt },
            responseCount = n, eligible, participation = eligible == 0 ? 0 : (int)Math.Round(100.0 * n / eligible),
            anonymityThreshold = AnonymityThreshold,
            questions = s.Questions.Select(q => Summarize(q, responses)),
            byDepartment = byDept,
        });
    }

    private static int? EnpsOf(Survey s, IEnumerable<SurveyResponse> rs)
    {
        var q = s.Questions.FirstOrDefault(x => x.Type == "Nps");
        if (q is null) return null;
        var sc = rs.SelectMany(r => r.Answers).Where(a => a.QuestionId == q.Id && a.Score != null).Select(a => a.Score!.Value).ToList();
        return sc.Count == 0 ? null : (int)Math.Round(100.0 * (sc.Count(x => x >= 9) - sc.Count(x => x <= 6)) / sc.Count);
    }

    private static int? FavorableOf(Survey s, IEnumerable<SurveyResponse> rs)
    {
        var ids = s.Questions.Where(x => x.Type == "Scale").Select(x => x.Id).ToHashSet();
        var sc = rs.SelectMany(r => r.Answers).Where(a => ids.Contains(a.QuestionId) && a.Score != null).Select(a => a.Score!.Value).ToList();
        return sc.Count == 0 ? null : (int)Math.Round(100.0 * sc.Count(x => x >= 4) / sc.Count);
    }
}

/* ======================================================================
 * Offboarding (işten ayrılış): kontrol listesi (açık zimmetler otomatik
 * eklenir), çıkış görüşmesi ve tahmini hak ediş hesabı (kıdem/ihbar/izin).
 * Hak ediş TAHMİNDİR — kesin bordro hesabı değildir, yasal dayanaklar
 * yanıtta belirtilir.
 * ==================================================================== */
[Route("api/offboarding")]
[Authorize(Policy = "RequireManagerOrAbove")]
[RequiresPlan("Standard")]
public class OffboardingController : AppController
{
    /// <summary>Kıdem tazminatı tavanı (01.07.2026–31.12.2026). Ortam değişkeniyle güncellenebilir.</summary>
    public static decimal SeveranceCeiling =>
        decimal.TryParse(Environment.GetEnvironmentVariable("SEVERANCE_CEILING_TRY"), System.Globalization.NumberStyles.Number,
            System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : 73_729.87m;

    private readonly EngagementDbContext _db;
    private readonly IHttpClientFactory _http;
    public OffboardingController(EngagementDbContext db, IHttpClientFactory http) { _db = db; _http = http; }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok((await _db.OffboardingCases.AsNoTracking().OrderByDescending(c => c.CreatedAt).ToListAsync(ct)).Select(c => new
        {
            c.Id, c.EmployeeId, c.EmployeeName, c.LastWorkingDay, c.Reason, c.Status, c.CreatedAt, c.CompletedAt,
            c.RehireEligible, progress = c.Checklist.Count == 0 ? 0 : (int)Math.Round(100.0 * c.Checklist.Count(i => i.Done) / c.Checklist.Count),
            total = c.Checklist.Count, done = c.Checklist.Count(i => i.Done), hasInterview = c.ExitInterview != null,
        }));

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var c = await _db.OffboardingCases.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        return c is null ? NotFound() : Ok(c);
    }

    public record CreateInput(Guid EmployeeId, DateOnly LastWorkingDay, string Reason);

    [HttpPost]
    public async Task<IActionResult> Create(CreateInput body, CancellationToken ct)
    {
        if (body.Reason is not ("Resignation" or "Termination" or "Retirement" or "ContractEnd" or "Other"))
            return BadRequest(new { message = "Geçersiz ayrılış nedeni." });
        var emp = await People.FindAsync(Tenant, body.EmployeeId, ct);
        if (emp is null) return NotFound(new { message = "Çalışan bulunamadı." });
        if (await _db.OffboardingCases.AnyAsync(c => c.EmployeeId == emp.Id && c.Status == "Open", ct))
            return Conflict(new { message = "Bu çalışan için açık bir ayrılış süreci var." });

        var assets = await Db.QueryAsync(
            """
            SELECT a."AssetTag", a."Type", a."Model" FROM onboarding_asset_assignments x
            JOIN onboarding_assets a ON a."Id" = x."AssetId"
            WHERE x."TenantSlug" = $1 AND x."EmployeeId" = $2 AND x."ReturnedOn" IS NULL
            """, r => $"{r.Str(1)} {r.Str(2)} ({r.Str(0)})".Trim(), ct, Tenant, emp.Id);

        var checklist = new List<ChecklistItem>
        {
            new() { Key = "handover", Title = "Devir-teslim planı ve dokümantasyon", Owner = "Yönetici" },
            new() { Key = "sgk", Title = "SGK işten ayrılış bildirgesi", Owner = "İK", Hint = "Ayrılış tarihinden itibaren 10 gün içinde verilmeli." },
            new() { Key = "payroll", Title = "Son maaş, kıdem/ihbar ve kullanılmayan izin hesabı", Owner = "Bordro" },
            new() { Key = "accounts", Title = "E-posta ve sistem erişimlerinin kapatılması", Owner = "BT", Hint = "Son iş günü mesai bitiminde." },
            new() { Key = "badge", Title = "Kart/anahtar iadesi", Owner = "İK" },
            new() { Key = "exit-interview", Title = "Çıkış görüşmesi", Owner = "İK" },
            new() { Key = "certificate", Title = "Çalışma belgesi (İş K. m.28)", Owner = "İK" },
            new() { Key = "release", Title = "İbraname / ayrılış evrakı", Owner = "İK" },
        };
        checklist.InsertRange(1, assets.Select((a, i) => new ChecklistItem { Key = $"asset-{i}", Title = $"Zimmet iadesi: {a}", Owner = "Çalışan" }));

        var c = new OffboardingCase
        {
            EmployeeId = emp.Id, EmployeeName = emp.Name, LastWorkingDay = body.LastWorkingDay, Reason = body.Reason, Checklist = checklist,
        };
        _db.OffboardingCases.Add(c);
        await _db.SaveChangesAsync(ct);
        return Ok(c);
    }

    public record ToggleInput(bool Done);

    [HttpPatch("{id:guid}/checklist/{key}")]
    public async Task<IActionResult> Toggle(Guid id, string key, ToggleInput body, CancellationToken ct)
    {
        var c = await _db.OffboardingCases.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (c.Status != "Open") return BadRequest(new { message = "Süreç kapalı." });
        var list = c.Checklist.Select(i => i.Key == key
            ? new ChecklistItem { Key = i.Key, Title = i.Title, Owner = i.Owner, Hint = i.Hint, Done = body.Done, DoneAt = body.Done ? DateTime.UtcNow : null, DoneBy = body.Done ? Me.Name : null }
            : i).ToList();
        c.Checklist = list;
        _db.Entry(c).Property(x => x.Checklist).IsModified = true;
        await _db.SaveChangesAsync(ct);
        return Ok(c);
    }

    public record InterviewInput(ExitInterview Interview, bool? RehireEligible);

    [HttpPut("{id:guid}/exit-interview")]
    public async Task<IActionResult> Interview(Guid id, InterviewInput body, CancellationToken ct)
    {
        var c = await _db.OffboardingCases.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        c.ExitInterview = body.Interview;
        c.RehireEligible = body.RehireEligible;
        _db.Entry(c).Property(x => x.ExitInterview).IsModified = true;
        var item = c.Checklist.FirstOrDefault(i => i.Key == "exit-interview");
        if (item is not null && !item.Done)
        {
            c.Checklist = c.Checklist.Select(i => i.Key == "exit-interview"
                ? new ChecklistItem { Key = i.Key, Title = i.Title, Owner = i.Owner, Hint = i.Hint, Done = true, DoneAt = DateTime.UtcNow, DoneBy = Me.Name } : i).ToList();
            _db.Entry(c).Property(x => x.Checklist).IsModified = true;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(c);
    }

    /// <summary>
    /// Süreci kapatır. <c>terminate=true</c> ise çalışanın durumu employee-service
    /// üzerinden (kullanıcının kendi jetonuyla — yetki orada da denetlenir)
    /// "Terminated" yapılır.
    /// </summary>
    [HttpPost("{id:guid}/complete")]
    public async Task<IActionResult> Complete(Guid id, [FromQuery] bool terminate = true, CancellationToken ct = default)
    {
        var c = await _db.OffboardingCases.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        if (c.Status != "Open") return BadRequest(new { message = "Süreç zaten kapalı." });
        var open = c.Checklist.Where(i => !i.Done).Select(i => i.Title).ToList();
        if (open.Count > 0) return BadRequest(new { message = $"Tamamlanmamış adımlar var: {string.Join(", ", open.Take(3))}{(open.Count > 3 ? "…" : "")}" });

        string? warning = null;
        if (terminate)
        {
            var url = (Environment.GetEnvironmentVariable("EMPLOYEE_SERVICE_URL") ?? "http://employee-service:8080") + $"/api/employees/{c.EmployeeId}/status";
            var req = new HttpRequestMessage(HttpMethod.Patch, url)
            {
                Content = JsonContent.Create(new { status = "Terminated", effectiveDate = c.LastWorkingDay }),
            };
            req.Headers.TryAddWithoutValidation("Authorization", Request.Headers.Authorization.ToString());
            try
            {
                var res = await _http.CreateClient().SendAsync(req, ct);
                if (!res.IsSuccessStatusCode) warning = $"Çalışan durumu güncellenemedi (HTTP {(int)res.StatusCode}); Çalışanlar ekranından elle güncelleyin.";
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                warning = "Çalışan servisine ulaşılamadı; durumu elle güncelleyin.";
            }
        }
        c.Status = "Completed";
        c.CompletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { c.Status, warning });
    }

    [HttpPost("{id:guid}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
    {
        var c = await _db.OffboardingCases.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        c.Status = "Cancelled";
        await _db.SaveChangesAsync(ct);
        return Ok(new { c.Status });
    }

    /// <summary>Tahmini hak ediş (yalnızca ücret görme yetkisi olanlar).</summary>
    [HttpGet("{id:guid}/settlement")]
    public async Task<IActionResult> Settlement(Guid id, CancellationToken ct)
    {
        if (!Me.IsHr && !Me.Roles.Contains("ext-compensation-view")) return Forbid();
        var c = await _db.OffboardingCases.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        var emp = await People.FindAsync(Tenant, c.EmployeeId, ct);
        if (emp is null) return NotFound();
        var gross = await Db.ScalarAsync(
            """
            SELECT "BaseSalary" FROM compensation_records WHERE "TenantSlug" = $1 AND "EmployeeId" = $2
            ORDER BY "EffectiveFrom" DESC LIMIT 1
            """, ct, Tenant, emp.Id) as decimal?;
        var remainingLeave = await Db.ScalarAsync(
            """
            SELECT coalesce(sum("EntitledDays" - "UsedDays"), 0) FROM leave_balances
            WHERE "TenantSlug" = $1 AND "EmployeeId" = $2 AND "Type" = 'Annual' AND "Year" = $3
            """, ct, Tenant, emp.Id, c.LastWorkingDay.Year) as decimal? ?? 0;

        var days = c.LastWorkingDay.DayNumber - emp.HireDate.DayNumber;
        var years = days / 365.25m;
        var noticeWeeks = years < 0.5m ? 2 : years < 1.5m ? 4 : years < 3 ? 6 : 8;
        var severanceEligible = years >= 1 && c.Reason is "Termination" or "Retirement" or "ContractEnd";
        var basis = gross is null ? 0 : Math.Min(gross.Value, SeveranceCeiling);
        var severance = severanceEligible ? Math.Round(basis * years, 2) : 0;
        var daily = gross is null ? 0 : gross.Value / 30m;
        var notice = c.Reason == "Termination" ? Math.Round(daily * noticeWeeks * 7, 2) : 0;
        var leavePay = Math.Round(daily * Math.Max(0, remainingLeave), 2);
        const decimal stamp = 0.00759m;

        return Ok(new
        {
            employee = emp.Name, hireDate = emp.HireDate, c.LastWorkingDay, c.Reason,
            tenureYears = Math.Round(years, 2), grossMonthly = gross, severanceCeiling = SeveranceCeiling,
            severance = new { eligible = severanceEligible, gross = severance, stampTax = Math.Round(severance * stamp, 2), net = Math.Round(severance * (1 - stamp), 2),
                basis = "4857 s. Kanun geçici 6 / 1475 s. Kanun m.14 — her tam yıl için 30 günlük brüt ücret (tavanla sınırlı); gelir vergisinden istisna, yalnızca damga vergisi." },
            notice = new { weeks = noticeWeeks, applies = c.Reason == "Termination", gross = notice,
                basis = "4857 s. İş Kanunu m.17 — işveren bildirimsiz feshederse ihbar süresine ait ücret; gelir ve damga vergisine tabidir." },
            unusedLeave = new { days = remainingLeave, gross = leavePay, basis = "4857 s. İş Kanunu m.59 — kullanılmayan yıllık izin ücreti." },
            totalGross = severance + notice + leavePay,
            disclaimer = "Tahmini hesaptır; kesin tutar bordro ve hukuk birimince ek ödemeler, yan haklar ve vergi dilimleri dikkate alınarak belirlenir.",
            hasSalary = gross is not null,
        });
    }
}
