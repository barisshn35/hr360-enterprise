using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;
using GovernanceService.Models;
using GovernanceService.Tenancy;

namespace GovernanceService.Controllers;

/* ======================================================================
 * Plan bazlı modül kısıtı: hangi özellik hangi planda. Arayüz menüyü bu
 * yanıta göre gizler; backend her uçta RequiresPlan ile ayrıca denetler.
 * ==================================================================== */
[Route("api/plan")]
[Authorize]
public class PlanController : AppController
{
    public static readonly Dictionary<string, string> Features = new()
    {
        ["kudos"] = "Trial", ["celebrations"] = "Trial", ["profile"] = "Trial", ["workplace"] = "Trial",
        ["surveys"] = "Trial", ["team-health"] = "Trial", ["payroll-sim"] = "Trial", ["calendar"] = "Trial",
        ["mentorship"] = "Standard", ["mobility"] = "Standard", ["one-on-ones"] = "Standard", ["offboarding"] = "Standard",
        ["privacy"] = "Standard", ["documents"] = "Standard", ["audit"] = "Standard", ["analytics"] = "Standard",
        ["assistant"] = "Standard", ["import-export"] = "Standard", ["ai-tools"] = "Standard",
        ["succession"] = "Enterprise", ["org-scenarios"] = "Enterprise", ["rules"] = "Enterprise", ["webhooks"] = "Enterprise",
        ["api-keys"] = "Enterprise", ["integrations"] = "Enterprise", ["events"] = "Enterprise", ["time-machine"] = "Enterprise",
        ["nl-report"] = "Enterprise", ["sso"] = "Enterprise", ["sagas"] = "Enterprise",
    };

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        var tc = HttpContext.RequestServices.GetRequiredService<ITenantContext>();
        var plan = string.IsNullOrEmpty(tc.TenantSlug) ? "Enterprise"
            : await Db.ScalarAsync("SELECT \"Plan\" FROM platform_tenants WHERE \"Slug\" = $1", ct, tc.TenantSlug) as string ?? "Trial";
        var rank = RequiresPlanAttribute.Rank(plan);
        var enforced = FeatureFlags.PlanEnforcement;
        return Ok(new
        {
            plan, rank,
            enforced,
            billingEnabled = FeatureFlags.Billing,
            features = Features,
            enabled = Features.Where(f => !enforced || tc.IsPlatformAdmin || RequiresPlanAttribute.Rank(f.Value) <= rank).Select(f => f.Key),
        });
    }
}

/* ======================================================================
 * Faturalama / abonelik: plan × koltuk (aktif çalışan) × birim fiyat + KDV.
 * Faturalar her ay otomatik kesilir (Housekeeping). Ödeme sağlayıcısı
 * (iyzico/Stripe) PAYMENT_PROVIDER ile bağlanır; tanımlı değilse havale/EFT
 * bilgisi gösterilir ve ödeme platform yöneticisince işaretlenir.
 * ==================================================================== */
/// <summary>BILLING_ENABLED kapaliyken faturalandirma uclari yokmus gibi davranir.</summary>
public sealed class RequiresBillingAttribute : Attribute, IActionFilter
{
    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!FeatureFlags.Billing)
            context.Result = new NotFoundObjectResult(new { message = "Bu kurulumda faturalandırma kapalı (BILLING_ENABLED).", code = "billing_disabled" });
    }
    public void OnActionExecuted(ActionExecutedContext context) { }
}

[Route("api/billing")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresBilling]
public class BillingController : AppController
{
    private readonly GovernanceDbContext _db;
    public BillingController(GovernanceDbContext db) => _db = db;

    private bool IsPlatform => Me.IsPlatformAdmin;

    [HttpGet("plans")]
    [AllowAnonymous]
    public IActionResult Plans() => Ok(Billing.PricePerSeat.Select(p => new { plan = p.Key, pricePerSeat = p.Value, currency = "TRY", vatRate = Billing.VatRate, minimumSeats = Billing.MinimumSeats,
        features = PlanController.Features.Where(f => RequiresPlanAttribute.Rank(f.Value) <= RequiresPlanAttribute.Rank(p.Key)).Select(f => f.Key) }));

    [HttpGet("me")]
    public async Task<IActionResult> Mine(CancellationToken ct)
    {
        var t = (await Db.QueryAsync("""
            SELECT t."Name", t."Plan", t."MaxEmployees", (SELECT count(*) FROM employee_employees e WHERE e."TenantSlug" = t."Slug" AND e."Status" <> 'Terminated')
            FROM platform_tenants t WHERE t."Slug" = $1
            """, r => (Name: r.GetString(0), Plan: r.GetString(1), Max: r.GetInt32(2), Seats: Convert.ToInt32(r.GetValue(3))), ct, Tenant)).FirstOrDefault();
        if (t.Name is null) return NotFound();
        var price = Billing.PricePerSeat.GetValueOrDefault(t.Plan);
        var seats = Math.Max(Billing.MinimumSeats, t.Seats);
        var invoices = await _db.Invoices.AsNoTracking().OrderByDescending(i => i.Period).Take(24).ToListAsync(ct);
        return Ok(new
        {
            company = t.Name, plan = t.Plan, activeEmployees = t.Seats, billableSeats = seats, maxEmployees = t.Max, pricePerSeat = price,
            estimate = new { amount = price * seats, tax = Math.Round(price * seats * Billing.VatRate, 2), total = Math.Round(price * seats * (1 + Billing.VatRate), 2) },
            paymentProvider = Environment.GetEnvironmentVariable("PAYMENT_PROVIDER"),
            invoices,
            outstanding = invoices.Where(i => i.Status == "Issued").Sum(i => i.Total),
        });
    }

    [HttpGet("invoices")]
    public async Task<IActionResult> Invoices([FromQuery] string? status, CancellationToken ct)
    {
        IQueryable<Invoice> q = IsPlatform ? _db.Invoices.IgnoreQueryFilters() : _db.Invoices;
        if (!string.IsNullOrEmpty(status)) q = q.Where(i => i.Status == status);
        return Ok(await q.AsNoTracking().OrderByDescending(i => i.Period).ThenBy(i => i.TenantSlug).Take(500).ToListAsync(ct));
    }

    [HttpPost("generate")]
    public async Task<IActionResult> Generate(CancellationToken ct)
    {
        if (!IsPlatform) return Forbid();
        var n = await Billing.GenerateAsync(Db, _db, DateTime.UtcNow, ct);
        return Ok(new { created = n });
    }

    public record PayInput(string? Reference);

    [HttpPost("invoices/{id:guid}/pay")]
    public async Task<IActionResult> MarkPaid(Guid id, PayInput body, CancellationToken ct)
    {
        if (!IsPlatform) return StatusCode(403, new { message = "Ödeme, sağlayıcı bağlanana kadar platform yöneticisince işaretlenir." });
        var inv = await _db.Invoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == id, ct);
        if (inv is null) return NotFound();
        inv.Status = "Paid";
        inv.PaidAt = DateTime.UtcNow;
        inv.PaymentRef = body.Reference;
        await _db.SaveChangesAsync(ct);
        return Ok(inv);
    }

    [HttpPost("invoices/{id:guid}/void")]
    public async Task<IActionResult> Void(Guid id, CancellationToken ct)
    {
        if (!IsPlatform) return Forbid();
        var inv = await _db.Invoices.IgnoreQueryFilters().FirstOrDefaultAsync(i => i.Id == id, ct);
        if (inv is null) return NotFound();
        inv.Status = "Void";
        await _db.SaveChangesAsync(ct);
        return Ok(inv);
    }

    [HttpGet("invoices/{id:guid}/html")]
    public async Task<IActionResult> Html(Guid id, CancellationToken ct)
    {
        var inv = await (IsPlatform ? _db.Invoices.IgnoreQueryFilters() : _db.Invoices).AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, ct);
        if (inv is null) return NotFound();
        var name = await Db.ScalarAsync("SELECT \"Name\" FROM platform_tenants WHERE \"Slug\" = $1", ct, inv.TenantSlug) as string ?? inv.TenantSlug;
        var tr = new CultureInfo(En ? "en-GB" : "tr-TR");
        string M(decimal v) => v.ToString("N2", tr) + " ₺";
        var html = $"""
            <div style="font-family:Inter,Arial,sans-serif;max-width:720px;margin:0 auto;color:#111">
              <div style="display:flex;justify-content:space-between;align-items:flex-start">
                <div><h1 style="margin:0;font-size:22px">HR360 Enterprise</h1><p style="color:#555;margin:4px 0">Abonelik faturası</p></div>
                <div style="text-align:right"><b>{WebUtility.HtmlEncode(inv.Number)}</b><br/>Dönem: {inv.Period}<br/>Düzenleme: {inv.IssuedAt.AddHours(3):dd.MM.yyyy}<br/>Son ödeme: {inv.DueAt.AddHours(3):dd.MM.yyyy}</div>
              </div>
              <p style="margin-top:24px">Sayın <b>{WebUtility.HtmlEncode(name)}</b>,</p>
              <table style="width:100%;border-collapse:collapse;margin-top:12px">
                <tr style="background:#f4f4f5"><th style="text-align:left;padding:8px">Açıklama</th><th style="padding:8px">Adet</th><th style="padding:8px;text-align:right">Birim</th><th style="padding:8px;text-align:right">Tutar</th></tr>
                <tr><td style="padding:8px">{inv.Plan} planı — aktif çalışan koltuğu</td><td style="padding:8px;text-align:center">{inv.Seats}</td><td style="padding:8px;text-align:right">{M(inv.UnitPrice)}</td><td style="padding:8px;text-align:right">{M(inv.Amount)}</td></tr>
                <tr><td colspan="3" style="padding:8px;text-align:right">KDV (%{Billing.VatRate * 100:0})</td><td style="padding:8px;text-align:right">{M(inv.TaxAmount)}</td></tr>
                <tr><td colspan="3" style="padding:8px;text-align:right"><b>Genel toplam</b></td><td style="padding:8px;text-align:right"><b>{M(inv.Total)}</b></td></tr>
              </table>
              <p style="margin-top:24px">Durum: <b>{(inv.Status == "Paid" ? "Ödendi" : inv.Status == "Void" ? "İptal" : "Ödeme bekliyor")}</b>{(inv.PaymentRef is null ? "" : " — ref: " + WebUtility.HtmlEncode(inv.PaymentRef))}</p>
              <p style="color:#666;font-size:12px;margin-top:32px">Bu belge bilgilendirme amaçlı proforma niteliğindedir; resmî e-fatura muhasebe sisteminden ayrıca düzenlenir.</p>
            </div>
            """;
        return Content(html, "text/html; charset=utf-8");
    }
}

/* ======================================================================
 * Takvim aboneliği (.ics): kişiye özel, gizli bağlantılı akış. Outlook /
 * Google Takvim / Apple Takvim "URL ile abone ol" ile eklenir; izinler,
 * resmî tatiller, 1:1'ler ve masa rezervasyonları görünür.
 * ==================================================================== */
[Route("api/calendar")]
[Authorize]
public class CalendarController : AppController
{
    private readonly GovernanceDbContext _db;
    public CalendarController(GovernanceDbContext db) => _db = db;

    private static string NewToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(20)).ToLowerInvariant();

    [HttpGet("feed")]
    public async Task<IActionResult> Feed(CancellationToken ct)
    {
        var f = await _db.CalendarFeeds.FirstOrDefaultAsync(x => x.UserId == Me.UserId, ct);
        if (f is null)
        {
            var me = await MyPersonAsync(ct);
            f = new CalendarFeed { UserId = Me.UserId, EmployeeId = me?.Id, Token = NewToken() };
            _db.CalendarFeeds.Add(f);
            await _db.SaveChangesAsync(ct);
        }
        return Ok(new { path = $"/api/governance/calendar/ics/{f.Token}.ics", f.CreatedAt });
    }

    [HttpPost("feed/rotate")]
    public async Task<IActionResult> Rotate(CancellationToken ct)
    {
        var f = await _db.CalendarFeeds.FirstOrDefaultAsync(x => x.UserId == Me.UserId, ct);
        if (f is null) return await Feed(ct);
        f.Token = NewToken();
        f.CreatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { path = $"/api/governance/calendar/ics/{f.Token}.ics", f.CreatedAt });
    }

    [HttpGet("ics/{token}.ics")]
    [AllowAnonymous]
    public async Task<IActionResult> Ics(string token, CancellationToken ct)
    {
        var feed = (await Db.QueryAsync("SELECT \"TenantSlug\", \"UserId\", \"EmployeeId\" FROM governance_calendar_feeds WHERE \"Token\" = $1",
            r => (Tenant: r.GetString(0), User: r.GetString(1), Emp: r.GuidOrNull(2)), ct, token)).FirstOrDefault();
        if (feed.Tenant is null) return NotFound();
        var tenant = feed.Tenant;
        var from = DateOnly.FromDateTime(DateTime.UtcNow).AddMonths(-3);
        var to = from.AddMonths(15);
        var sb = new StringBuilder("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//HR360//Takvim//TR\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:HR360\r\nX-WR-TIMEZONE:Europe/Istanbul\r\n");
        void AllDay(string uid, DateOnly start, DateOnly endInclusive, string summary, string? desc = null)
        {
            sb.Append($"BEGIN:VEVENT\r\nUID:{uid}@hr360\r\nDTSTAMP:{DateTime.UtcNow:yyyyMMddTHHmmssZ}\r\nDTSTART;VALUE=DATE:{start:yyyyMMdd}\r\nDTEND;VALUE=DATE:{endInclusive.AddDays(1):yyyyMMdd}\r\nSUMMARY:{Esc(summary)}\r\n");
            if (desc is not null) sb.Append($"DESCRIPTION:{Esc(desc)}\r\n");
            sb.Append("TRANSP:TRANSPARENT\r\nEND:VEVENT\r\n");
        }
        void Timed(string uid, DateTime startUtc, DateTime endUtc, string summary)
            => sb.Append($"BEGIN:VEVENT\r\nUID:{uid}@hr360\r\nDTSTAMP:{DateTime.UtcNow:yyyyMMddTHHmmssZ}\r\nDTSTART:{startUtc:yyyyMMddTHHmmssZ}\r\nDTEND:{endUtc:yyyyMMddTHHmmssZ}\r\nSUMMARY:{Esc(summary)}\r\nEND:VEVENT\r\n");

        foreach (var h in await Db.QueryAsync("SELECT \"Id\", \"Date\", \"Name\" FROM leave_public_holidays WHERE \"TenantSlug\" = $1 AND \"Date\" BETWEEN $2 AND $3",
                     r => (Id: r.GetGuid(0), Date: r.GetFieldValue<DateOnly>(1), Name: r.GetString(2)), ct, tenant, from, to))
            AllDay(h.Id.ToString(), h.Date, h.Date, $"🇹🇷 {h.Name}");

        if (feed.Emp is { } emp)
        {
            foreach (var l in await Db.QueryAsync("""
                SELECT "Id", "StartDate", "EndDate", "Type", "Status", "Days" FROM leave_requests
                WHERE "TenantSlug" = $1 AND "EmployeeId" = $2 AND "Status" IN ('Approved','Submitted') AND "EndDate" >= $3
                """, r => (Id: r.GetGuid(0), S: r.GetFieldValue<DateOnly>(1), E: r.GetFieldValue<DateOnly>(2), T: r.GetString(3), St: r.GetString(4), D: r.GetDecimal(5)), ct, tenant, emp, from))
                AllDay(l.Id.ToString(), l.S, l.E, $"{(l.St == "Approved" ? "" : "(onay bekliyor) ")}İzin — {LeaveLabel(l.T)}", $"{l.D:0.#} gün");

            // Yöneticiyse: başı olduğu departmandaki ekip izinleri
            foreach (var l in await Db.QueryAsync("""
                SELECT l."Id", l."StartDate", l."EndDate", e."FirstName" || ' ' || e."LastName" FROM leave_requests l
                JOIN employee_employees e ON e."Id" = l."EmployeeId"
                JOIN employee_assignments a ON a."EmployeeId" = e."Id" AND a."EffectiveTo" IS NULL
                JOIN organization_departments d ON d."Id" = a."DepartmentId" AND d."HeadEmployeeId" = $2
                WHERE l."TenantSlug" = $1 AND l."Status" = 'Approved' AND l."EmployeeId" <> $2 AND l."EndDate" >= $3
                """, r => (Id: r.GetGuid(0), S: r.GetFieldValue<DateOnly>(1), E: r.GetFieldValue<DateOnly>(2), N: r.GetString(3)), ct, tenant, emp, from))
                AllDay("team-" + l.Id, l.S, l.E, $"Ekip izni: {l.N}");

            foreach (var b in await Db.QueryAsync("""
                SELECT b."Id", b."Date", b."StartMinute", b."EndMinute", d."Name" FROM engagement_desk_bookings b JOIN engagement_desks d ON d."Id" = b."DeskId"
                WHERE b."TenantSlug" = $1 AND b."UserId" = $2 AND b."Date" >= $3
                """, r => (Id: r.GetGuid(0), D: r.GetFieldValue<DateOnly>(1), S: r.GetInt32(2), E: r.GetInt32(3), N: r.GetString(4)), ct, tenant, feed.User, from))
            {
                var start = b.D.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc).AddMinutes(b.S - 180);
                Timed(b.Id.ToString(), start, start.AddMinutes(b.E - b.S), $"Rezervasyon: {b.N}");
            }
        }
        foreach (var o in await Db.QueryAsync("""
            SELECT "Id", "ScheduledAt", "ManagerName", "EmployeeName" FROM engagement_one_on_ones
            WHERE "TenantSlug" = $1 AND ("ManagerUserId" = $2 OR "EmployeeUserId" = $2) AND "Status" = 'Planned'
            """, r => (Id: r.GetGuid(0), At: r.GetFieldValue<DateTime>(1), M: r.GetString(2), E: r.GetString(3)), ct, tenant, feed.User))
            Timed(o.Id.ToString(), o.At, o.At.AddMinutes(30), $"1:1 — {o.M} / {o.E}");

        sb.Append("END:VCALENDAR\r\n");
        return File(Encoding.UTF8.GetBytes(sb.ToString()), "text/calendar; charset=utf-8");
    }

    private static string LeaveLabel(string t) => t switch
    {
        "Annual" => "Yıllık", "Sick" => "Hastalık", "Unpaid" => "Ücretsiz", "Maternity" => "Doğum", "Paternity" => "Babalık",
        "Marriage" => "Evlilik", "Bereavement" => "Vefat", _ => t,
    };

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace(",", "\\,").Replace(";", "\\;").Replace("\n", "\\n");
}

/* ======================================================================
 * İK asistanı + doğal dilde rapor + bilgi bankası.
 * Asistan: kişisel veriye dair sık soruları (izin bakiyem, bekleyen
 * taleplerim, sonraki resmî tatil…) doğrudan veriden, politika sorularını
 * bilgi bankasından (İK'nın yazdığı maddeler) yanıtlar. Yöneticinin
 * analitik soruları doğal dilde rapor motoruna (NlReport) gider.
 * Kural tabanlıdır; bilmediğini uydurmaz.
 * ==================================================================== */
[Route("api/insights")]
[Authorize]
[RequiresPlan("Standard")]
public class InsightsController : AppController
{
    private readonly GovernanceDbContext _db;
    public InsightsController(GovernanceDbContext db) => _db = db;

    public record AskInput(string Question);

    [HttpGet("examples")]
    public IActionResult ExampleQuestions() => Ok(NlReport.ExamplesFor(Lang));

    [HttpPost("report")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    [RequiresPlan("Enterprise")]
    public async Task<IActionResult> Report(AskInput body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Question) || body.Question.Length > 300) return BadRequest(new { message = L("Soru 1–300 karakter olmalı.", "The question must be 1–300 characters.") });
        return Ok(await NlReport.RunAsync(Db, Tenant, body.Question, Me.IsHr, ct, Lang));
    }

    [HttpPost("assistant")]
    public async Task<IActionResult> Assistant(AskInput body, CancellationToken ct)
    {
        var raw = body.Question?.Trim() ?? "";
        if (raw.Length is 0 or > 500) return BadRequest(new { message = L("Mesaj 1–500 karakter olmalı.", "The message must be 1–500 characters.") });
        var q = " " + NlReport.Norm(raw) + " ";
        var me = await MyPersonAsync(ct);
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        var tr = new CultureInfo("tr-TR");

        if (Has(q, "merhaba", "selam", "yardim", "neler yapabilirsin", "ne yapabilirsin", " hello", " hi ", " hey ", " help", "what can you do"))
            return Reply(L("Merhaba! Şunları sorabilirsiniz: **izin bakiyem**, **bekleyen taleplerim**, **sonraki resmî tatil**, **bugün kim izinde**, **masraflarım**",
                    "Hello! You can ask: **my leave balance**, **my pending requests**, **next public holiday**, **who is on leave today**, **my expenses**") +
                (Me.IsManager ? L(", ya da *\"son 6 ayda departmanlara göre izin günleri\"* gibi rapor soruları.", ", or report questions like *\"leave days by department in the last 6 months\"*.")
                              : L(". Şirket politikalarını da sorabilirsiniz (ör. *uzaktan çalışma*).", ". You can also ask about company policies (e.g. *remote work*).")), "help");

        if ((Has(q, "izin") && Has(q, "bakiye", "kac gun", "kalan", "hakkim", "ne kadar")) || (Has(q, " leave", "time off", "vacation") && Has(q, "balance", "how many days", " left", "remaining")))
        {
            if (me is null) return Reply(L("Hesabınız bir çalışan kaydına bağlı olmadığı için izin bakiyesi yok.", "Your account is not linked to an employee record, so there is no leave balance."), "data");
            var rows = await Db.QueryAsync("""
                SELECT "Type", "EntitledDays", "UsedDays", "PendingDays" FROM leave_balances
                WHERE "TenantSlug" = $1 AND "EmployeeId" = $2 AND "Year" = $3 ORDER BY 1
                """, r => (T: r.GetString(0), E: r.GetDecimal(1), U: r.GetDecimal(2), P: r.GetDecimal(3)), ct, Tenant, me.Id, today.Year);
            if (rows.Count == 0) return Reply(L($"{today.Year} için tanımlı izin bakiyeniz yok. İK ile görüşebilirsiniz.", $"You have no leave balance defined for {today.Year}. Please contact HR."), "data", (L("İzin ekranı", "Leave"), "/panel/izin"));
            var lines = rows.Select(r => En
                ? $"• **{LeaveLabel(r.T, true)}**: {r.E - r.U - r.P:0.#} days available ({r.U:0.#} used, {r.P:0.#} pending, {r.E:0.#} total)"
                : $"• **{LeaveLabel(r.T)}**: {r.E - r.U - r.P:0.#} gün kullanılabilir ({r.U:0.#} kullanıldı, {r.P:0.#} onay bekliyor, toplam {r.E:0.#})");
            return Reply(L($"{today.Year} izin durumunuz:\n", $"Your leave for {today.Year}:\n") + string.Join("\n", lines), "data", (L("İzin talebi oluştur", "Request leave"), "/panel/izin"));
        }

        if (Has(q, "bekleyen", "onay bekleyen", "taleplerim", "talebim", "pending", "my request", "awaiting"))
        {
            if (me is null) return Reply(L("Hesabınız bir çalışan kaydına bağlı değil.", "Your account is not linked to an employee record."), "data");
            var mine = await Db.QueryAsync("""
                SELECT "Subject", "CreatedAt" FROM workflow_requests WHERE "TenantSlug" = $1 AND "RequesterEmployeeId" = $2 AND "Status" = 'Pending' ORDER BY 2 DESC LIMIT 10
                """, r => (S: r.GetString(0), At: r.GetFieldValue<DateTime>(1)), ct, Tenant, me.Id);
            var waiting = Convert.ToInt64(await Db.ScalarAsync("""
                SELECT count(DISTINCT s."WorkflowRequestId") FROM workflow_approval_steps s JOIN workflow_requests w ON w."Id" = s."WorkflowRequestId"
                WHERE s."TenantSlug" = $1 AND w."Status" = 'Pending' AND s."Decision" = 'Pending' AND coalesce(s."DelegatedToEmployeeId", s."ApproverEmployeeId") = $2
                """, ct, Tenant, me.Id));
            var text = mine.Count == 0 ? L("Onay bekleyen talebiniz yok.", "You have no requests awaiting approval.")
                : L($"Onay bekleyen **{mine.Count}** talebiniz var:\n", $"You have **{mine.Count}** request(s) awaiting approval:\n") + string.Join("\n", mine.Select(m => $"• {m.S} ({m.At.AddHours(3):dd.MM})"));
            if (waiting > 0) text += L($"\n\nAyrıca **sizin kararınızı bekleyen {waiting} talep** var.", $"\n\nThere are also **{waiting} request(s) awaiting your decision**.");
            return Reply(text, "data", (L("Onay kutusu", "Approvals"), "/panel/onaylar"));
        }

        if (Has(q, "tatil", "bayram", "holiday"))
        {
            var next = await Db.QueryAsync("SELECT \"Date\", \"Name\" FROM leave_public_holidays WHERE \"TenantSlug\" = $1 AND \"Date\" >= $2 ORDER BY 1 LIMIT 5",
                r => (D: r.GetFieldValue<DateOnly>(0), N: r.GetString(1)), ct, Tenant, today);
            return Reply(next.Count == 0 ? L("Tanımlı yaklaşan resmî tatil yok.", "No upcoming public holidays are defined.") :
                L("Yaklaşan resmî tatiller:\n", "Upcoming public holidays:\n") + string.Join("\n", next.Select(n => En
                    ? $"• **{n.N}** — {n.D.ToString("dddd, d MMMM yyyy", tr)} (in {n.D.DayNumber - today.DayNumber} days)"
                    : $"• **{n.N}** — {n.D.ToString("d MMMM yyyy, dddd", tr)} ({n.D.DayNumber - today.DayNumber} gün sonra)")), "data");
        }

        if (Has(q, "kim izinde", "izindekiler", "izinde kim", "bugun izinde", "who is on leave", "who's on leave", "who is off", "on leave today"))
        {
            var rows = await Db.QueryAsync("""
                SELECT e."FirstName" || ' ' || e."LastName", l."EndDate" FROM leave_requests l JOIN employee_employees e ON e."Id" = l."EmployeeId"
                WHERE l."TenantSlug" = $1 AND l."Status" = 'Approved' AND l."StartDate" <= $2 AND l."EndDate" >= $2 ORDER BY 1
                """, r => (N: r.GetString(0), E: r.GetFieldValue<DateOnly>(1)), ct, Tenant, today);
            return Reply(rows.Count == 0 ? L("Bugün izinde olan kimse yok.", "Nobody is on leave today.")
                    : L("Bugün izinde olanlar:\n", "On leave today:\n") + string.Join("\n", rows.Select(r => En ? $"• {r.N} — until {r.E:dd.MM}" : $"• {r.N} — {r.E:dd.MM}'e kadar")),
                "data", (L("Kim nerede", "Who's where"), "/panel/ofis"));
        }

        if (Has(q, "masraf", "expense"))
        {
            if (me is null) return Reply(L("Hesabınız bir çalışan kaydına bağlı değil.", "Your account is not linked to an employee record."), "data");
            var rows = await Db.QueryAsync("""
                SELECT "Title", "TotalAmount", "Currency", "Status" FROM expense_claims WHERE "TenantSlug" = $1 AND "EmployeeId" = $2 ORDER BY "CreatedAt" DESC LIMIT 5
                """, r => (T: r.GetString(0), A: r.GetDecimal(1), C: r.GetString(2), S: r.GetString(3)), ct, Tenant, me.Id);
            if (rows.Count > 0 || !Has(q, "politika", "limit", "kural", "nasil", "policy", "rule", " how "))
                return Reply(rows.Count == 0 ? L("Henüz masraf beyanınız yok.", "You have no expense claims yet.") :
                    L("Son masraflarınız:\n", "Your recent expenses:\n") + string.Join("\n", rows.Select(r => $"• {r.T}: {r.A.ToString("N2", tr)} {r.C} — {ExpenseLabel(r.S, En)}")), "data", (L("Masraf ekranı", "Expenses"), "/panel/masraf"));
        }

        if (Has(q, "maas", "bordro", "net ucret", "brut", "salary", "payroll", "gross", "net pay"))
            return Reply(L("Brütten nete hesap için **Bordro simülasyonu** ekranını kullanabilirsiniz (2026 SGK, gelir vergisi dilimleri ve asgari ücret istisnası dahil).",
                    "Use the **Payroll simulation** screen for gross-to-net calculations (2026 SGK, income tax brackets and minimum wage exemption included)."),
                "help", (L("Bordro simülasyonu", "Payroll simulation"), "/panel/bordro-simulasyonu"));

        // Yönetici analitik sorusu → rapor motoru
        if (Me.IsManager && Has(q, "kac", "sayisi", "toplam", "ortalama", "dagilim", "gore", "aylik", "en cok", "trend",
                "how many", "number of", "total", "average", " by ", "monthly", " most ", "count", "headcount"))
        {
            var report = await NlReport.RunAsync(Db, Tenant, raw, Me.IsHr, ct, Lang);
            if (report.Understood)
                return Ok(new { reply = report.Interpretation + ":", source = "report", report, links = new[] { new { label = L("Doğal dilde rapor", "Report assistant"), path = "/panel/rapor-asistani" } } });
        }

        // Yapay zekâ açıksa: bilgi bankası bağlamıyla model yanıtı (kişisel veri gönderilmez).
        var ai = HttpContext.RequestServices.GetRequiredService<Infrastructure.Ai.AiGateway>();
        if (await ai.EnabledAsync(ct))
        {
            var (reply, related, failure) = await ai.AssistantAsync(Me.UserId, raw, ct);
            if (failure is null && !string.IsNullOrWhiteSpace(reply))
                return Ok(new { reply, source = "llm", related, links = Array.Empty<object>() });
        }

        // Bilgi bankası
        var words = q.Split(new[] { ' ', ',', '.', '?', '!', ':', ';' }, StringSplitOptions.RemoveEmptyEntries).Where(w => w.Length > 2).ToHashSet();
        var articles = await _db.KbArticles.AsNoTracking().ToListAsync(ct);
        var best = articles.Select(a =>
            {
                var t = NlReport.Norm(a.Title); var b = NlReport.Norm(a.Body); var tags = a.Tags.Select(NlReport.Norm).ToList();
                var score = words.Sum(w => (t.Contains(w) ? 3 : 0) + (tags.Any(x => x.Contains(w) || w.Contains(x)) ? 3 : 0) + (b.Contains(w) ? 1 : 0));
                return (a, score);
            })
            .Where(x => x.score >= 3).OrderByDescending(x => x.score).Take(2).ToList();
        if (best.Count > 0)
            return Ok(new { reply = $"**{best[0].a.Title}**\n\n{best[0].a.Body}", source = "kb",
                related = best.Skip(1).Select(x => x.a.Title), links = Array.Empty<object>() });

        return Reply(L("Bunu yanıtlayacak bir bilgiye sahip değilim. Sorunuzu İK'ya bir **İK vakası** olarak iletebilirsiniz; ilgili kişi size dönecektir.",
                "I don't have information to answer that. You can send your question to HR as an **HR case**; the right person will get back to you."),
            "fallback", (L("İK vakası aç", "Open an HR case"), "/panel/ik-vakalari"));
    }

    private IActionResult Reply(string text, string source, params (string Label, string Path)[] links) =>
        Ok(new { reply = text, source, links = links.Select(l => new { label = l.Label, path = l.Path }) });

    private static bool Has(string q, params string[] words) => words.Any(q.Contains);

    private static string LeaveLabel(string t, bool en = false) => en ? t switch
    {
        "Annual" => "Annual leave", "Sick" => "Sick leave", "Unpaid" => "Unpaid leave", "Maternity" => "Maternity leave", "Paternity" => "Paternity leave",
        "Marriage" => "Marriage leave", "Bereavement" => "Bereavement leave", _ => t,
    } : t switch
    {
        "Annual" => "Yıllık izin", "Sick" => "Hastalık izni", "Unpaid" => "Ücretsiz izin", "Maternity" => "Doğum izni", "Paternity" => "Babalık izni",
        "Marriage" => "Evlilik izni", "Bereavement" => "Vefat izni", _ => t,
    };

    private static string ExpenseLabel(string s, bool en = false) => en ? s switch
    {
        "Draft" => "draft", "Submitted" => "in approval", "Approved" => "approved", "Rejected" => "rejected", "Paid" => "paid", _ => s,
    } : s switch
    {
        "Draft" => "taslak", "Submitted" => "onayda", "Approved" => "onaylandı", "Rejected" => "reddedildi", "Paid" => "ödendi", _ => s,
    };

    /* ---------------------------------------------------- bilgi bankası */

    [HttpGet("kb")]
    public async Task<IActionResult> Kb(CancellationToken ct) => Ok(await _db.KbArticles.AsNoTracking().OrderBy(a => a.Title).ToListAsync(ct));

    public record KbInput(string Title, string Body, List<string>? Tags);

    [HttpPost("kb")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> CreateKb(KbInput body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Title) || string.IsNullOrWhiteSpace(body.Body)) return BadRequest(new { message = "Başlık ve içerik zorunlu." });
        var a = new KbArticle { Title = body.Title.Trim(), Body = body.Body.Trim(), Tags = body.Tags ?? new() };
        _db.KbArticles.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(a);
    }

    [HttpPut("kb/{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> UpdateKb(Guid id, KbInput body, CancellationToken ct)
    {
        var a = await _db.KbArticles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        a.Title = body.Title.Trim(); a.Body = body.Body.Trim(); a.Tags = body.Tags ?? new(); a.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(a);
    }

    [HttpDelete("kb/{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> DeleteKb(Guid id, CancellationToken ct)
    {
        var a = await _db.KbArticles.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        _db.KbArticles.Remove(a);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("kb/samples")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> KbSamples(CancellationToken ct)
    {
        var have = await _db.KbArticles.Select(a => a.Title).ToListAsync(ct);
        var samples = new (string T, string B, string[] Tags)[]
        {
            ("Yıllık izin politikası", "1–5 yıl kıdemde 14, 5–15 yılda 20, 15 yıl ve üzerinde 26 iş günü yıllık izin hakkı vardır (İş K. m.53). 18 yaş altı ve 50 yaş üstü için en az 20 gündür. İzin talebi en az 1 hafta önceden yöneticiye iletilir; bölünerek kullanılabilir, bir parçası 10 günden az olamaz.", new[] { "izin", "yillik izin", "tatil" }),
            ("Uzaktan çalışma", "Haftada en fazla 2 gün uzaktan çalışılabilir. Çalışma yerinizi Ofis → Kim nerede ekranından günlük bildirmeniz rica edilir. Çekirdek saatler 10:00–16:00'dır.", new[] { "uzaktan", "hibrit", "evden", "remote" }),
            ("Masraf politikası", "Masraflar harcamadan sonraki 30 gün içinde fişiyle beyan edilir. Yemek limiti kişi başı günlük 750 ₺, şehir içi ulaşımda taksi yalnızca 22:00 sonrası kabul edilir. Onaylanan masraflar takip eden ayın maaşıyla ödenir.", new[] { "masraf", "harcama", "fis", "limit" }),
            ("Maaş ödeme günü", "Maaşlar her ayın son iş günü hesabınıza yatar. Bordronuz e-posta ile gönderilir.", new[] { "maas", "bordro", "odeme" }),
            ("Hastalık raporu", "Rapor alındığında aynı gün yöneticinize ve İK'ya bildirin; e-Rapor SGK sisteminden otomatik düşer. 2 güne kadar raporlar için ücret kesintisi yapılmaz.", new[] { "rapor", "hastalik", "saglik" }),
            ("KVKK başvurusu nasıl yapılır?", "Kişisel verilerinize erişmek, düzeltmek veya silinmesini istemek için Profil → Gizlilik (KVKK) ekranından başvuru oluşturabilirsiniz. Başvurular en geç 30 gün içinde yanıtlanır. Verilerinizi aynı ekrandan JSON olarak indirebilirsiniz.", new[] { "kvkk", "kisisel veri", "gizlilik" }),
        };
        var added = 0;
        foreach (var s in samples.Where(s => !have.Contains(s.T)))
        {
            _db.KbArticles.Add(new KbArticle { Title = s.T, Body = s.B, Tags = s.Tags.ToList() });
            added++;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(new { added });
    }
}

/* ======================================================================
 * Teklif → işe alım sagası. recruitment (başvuru "Hired") → employee
 * (çalışan kaydı) → onboarding (işe giriş planı). Her adım idempotenttir:
 * önce sonucun var olup olmadığına bakılır, yoksa sahibi olan servisin
 * API'si kullanıcının kendi jetonuyla çağrılır. İzleme ekranı takılan
 * başvuruları (ör. çalışan kaydı açılmamış) gösterir.
 * ==================================================================== */
[Route("api/sagas/offer-to-hire")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class SagaController : AppController
{
    private readonly IHttpClientFactory _http;
    public SagaController(IHttpClientFactory http) => _http = http;

    private sealed record Row(Guid ApplicationId, string Status, DateTime? ChangedAt, string Candidate, string Email, string? Phone, string Posting,
        Guid? EmployeeId, Guid? PlanId, string? PlanStatus);

    private async Task<List<Row>> LoadAsync(Guid? applicationId, CancellationToken ct) => await Db.QueryAsync("""
        SELECT a."Id", a."Status", coalesce(a."StatusChangedAt", a."AppliedAt"), c."FirstName" || ' ' || c."LastName", c."Email", c."Phone", p."Title",
               e."Id", o."Id", o."Status"
        FROM recruitment_applications a
        JOIN recruitment_candidates c ON c."Id" = a."CandidateId"
        JOIN recruitment_job_postings p ON p."Id" = a."JobPostingId"
        LEFT JOIN employee_employees e ON e."TenantSlug" = a."TenantSlug" AND lower(e."Email") = lower(c."Email")
        LEFT JOIN LATERAL (SELECT x."Id", x."Status" FROM onboarding_plans x WHERE x."EmployeeId" = e."Id" ORDER BY x."CreatedAt" DESC LIMIT 1) o ON true
        WHERE a."TenantSlug" = $1 AND a."Status" IN ('Offer','Hired') AND ($2::uuid IS NULL OR a."Id" = $2)
        ORDER BY 3 DESC
        """, r => new Row(r.GetGuid(0), r.GetString(1), r.Ts(2), r.GetString(3), r.GetString(4), r.Str(5), r.GetString(6), r.GuidOrNull(7), r.GuidOrNull(8), r.Str(9)),
        ct, Tenant, applicationId);

    private static object Shape(Row r)
    {
        var stage = r.Status == "Offer" ? "Offer" : r.EmployeeId is null ? "AwaitingEmployee" : r.PlanId is null ? "AwaitingOnboarding" : "Completed";
        var days = r.ChangedAt is null ? 0 : (int)(DateTime.UtcNow - r.ChangedAt.Value).TotalDays;
        return new
        {
            r.ApplicationId, candidate = r.Candidate, email = r.Email, posting = r.Posting, applicationStatus = r.Status, stage,
            steps = new[]
            {
                new { key = "offer", label = "Teklif", done = true },
                new { key = "hired", label = "İşe alındı", done = r.Status == "Hired" },
                new { key = "employee", label = "Çalışan kaydı", done = r.EmployeeId != null },
                new { key = "onboarding", label = "Onboarding planı", done = r.PlanId != null },
            },
            r.EmployeeId, onboardingPlanId = r.PlanId, onboardingStatus = r.PlanStatus, daysInStage = days,
            stuck = stage is "AwaitingEmployee" or "AwaitingOnboarding" && days >= 2,
        };
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var rows = (await LoadAsync(null, ct)).Select(Shape).ToList();
        return Ok(rows);
    }

    public record AdvanceInput(DateOnly? StartDate);

    [HttpPost("{applicationId:guid}/advance")]
    public async Task<IActionResult> Advance(Guid applicationId, AdvanceInput body, CancellationToken ct)
    {
        var row = (await LoadAsync(applicationId, ct)).FirstOrDefault();
        if (row is null) return NotFound();
        if (row.Status != "Hired") return BadRequest(new { message = "Önce başvuru İşe alım ekranında \"İşe alındı\" yapılmalı." });
        var log = new List<string>();
        var start = body.StartDate ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(14));
        var client = _http.CreateClient();
        var auth = Request.Headers.Authorization.ToString();
        var empId = row.EmployeeId;

        if (empId is null)
        {
            var parts = row.Candidate.Split(' ', 2);
            var req = new HttpRequestMessage(HttpMethod.Post, (Environment.GetEnvironmentVariable("EMPLOYEE_SERVICE_URL") ?? "http://employee-service:8080") + "/api/employees")
            { Content = JsonContent.Create(new { firstName = parts[0], lastName = parts.Length > 1 ? parts[1] : "-", email = row.Email, phone = row.Phone, hireDate = start }) };
            req.Headers.TryAddWithoutValidation("Authorization", auth);
            var res = await client.SendAsync(req, ct);
            var text = await res.Content.ReadAsStringAsync(ct);
            if (!res.IsSuccessStatusCode) return StatusCode(502, new { message = $"Çalışan kaydı açılamadı: {Trim(text)}", log });
            empId = System.Text.Json.JsonDocument.Parse(text).RootElement.GetProperty("id").GetGuid();
            log.Add("Çalışan kaydı oluşturuldu");
        }
        else log.Add("Çalışan kaydı zaten var");

        if (row.PlanId is null)
        {
            var req = new HttpRequestMessage(HttpMethod.Post, (Environment.GetEnvironmentVariable("ONBOARDING_SERVICE_URL") ?? "http://onboarding-service:8080") + "/api/onboarding-plans")
            { Content = JsonContent.Create(new { employeeId = empId, startDate = start, templateName = "Standart işe giriş", useDefaultTasks = true }) };
            req.Headers.TryAddWithoutValidation("Authorization", auth);
            var res = await client.SendAsync(req, ct);
            if (!res.IsSuccessStatusCode) return StatusCode(502, new { message = $"Onboarding planı açılamadı: {Trim(await res.Content.ReadAsStringAsync(ct))}", log });
            log.Add("Onboarding planı oluşturuldu");
        }
        else log.Add("Onboarding planı zaten var");

        var after = (await LoadAsync(applicationId, ct)).First();
        return Ok(new { log, saga = Shape(after) });
    }

    private static string Trim(string s) => s.Length > 200 ? s[..200] : s;
}
