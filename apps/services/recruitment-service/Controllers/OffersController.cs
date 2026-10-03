using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RecruitmentService.Data;
using RecruitmentService.Models;
using RecruitmentService.Services;
using RecruitmentService.Tenancy;

namespace RecruitmentService.Controllers;

/// <summary>
/// Y18: iş teklifi ve onayı.
///  * İK teklif oluşturur → kiracı şablonundan mektup üretilir → workflow-service'te "OfferApproval"
///    akışı açılır (onaycı: ilanın departman başı). Departman başı yoksa (ya da teklifi açan
///    kendisiyse) İK doğrudan karar verir.
///  * Karar Kafka olayıyla (WorkflowEventConsumer) teklife işlenir. Yalnızca onaylı teklif adaya
///    gönderilir; yalnızca gönderilmiş teklif kabul/ret edilir. Kabul edilen teklifin başvurusu
///    "İşe alındı" olur — governance "offer-to-hire" sagası bu durumu izler.
///  * Brüt ücret yalnızca İK ve teklifin onaycısına gösterilir (görüntüleme denetlenir); bildirim
///    metinlerine ve akış konusuna asla yazılmaz.
/// </summary>
[ApiController]
[Route("api/offers")]
[Authorize]
public class OffersController : ControllerBase
{
    private readonly RecruitmentDbContext _db;
    private readonly ITenantContext _tenant;
    private readonly ApprovalWorkflowClient _workflow;

    public OffersController(RecruitmentDbContext db, ITenantContext tenant, ApprovalWorkflowClient workflow)
    {
        _db = db;
        _tenant = tenant;
        _workflow = workflow;
    }

    private string Tenant => _tenant.TenantSlug ?? "";
    private bool IsHr => RecruitmentSql.IsHr(User);
    private Task<Guid?> MeAsync(CancellationToken ct) => _db.MyEmployeeIdAsync(_tenant.TenantSlug, RecruitmentSql.UserId(User), ct);
    private static readonly string[] Currencies = { "TRY", "USD", "EUR", "GBP" };

    // ------------------------------------------------------------------ şablon

    private async Task<string> TemplateAsync(CancellationToken ct) =>
        (await _db.OfferTemplates.AsNoTracking().FirstOrDefaultAsync(ct))?.Body ?? OfferRules.DefaultTemplate;

    [HttpGet("template")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> GetTemplate(CancellationToken ct)
    {
        var t = await _db.OfferTemplates.AsNoTracking().FirstOrDefaultAsync(ct);
        return Ok(new { body = t?.Body ?? OfferRules.DefaultTemplate, isDefault = t is null, placeholders = OfferRules.Placeholders });
    }

    public record TemplateBody(string? Body);

    [HttpPut("template")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> PutTemplate([FromBody] TemplateBody body, CancellationToken ct)
    {
        var error = OfferRules.ValidateTemplate(body.Body);
        if (error is not null) return BadRequest(new { message = error });
        var t = await _db.OfferTemplates.FirstOrDefaultAsync(ct);
        if (t is null) { t = new OfferTemplate(); _db.OfferTemplates.Add(t); }
        t.Body = body.Body!.Replace("\r\n", "\n");
        t.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(new { body = t.Body, isDefault = false, placeholders = OfferRules.Placeholders });
    }

    // ------------------------------------------------------------------ oluşturma

    public record OfferInput(Guid ApplicationId, string? PositionTitle, decimal GrossSalary, string? Currency,
        DateOnly StartDate, string? Benefits, DateOnly ExpiresAt);

    private async Task<(Application? App, string? Error)> ValidateAsync(OfferInput b, CancellationToken ct)
    {
        var app = await _db.Applications.Include(a => a.Candidate).Include(a => a.JobPosting).FirstOrDefaultAsync(a => a.Id == b.ApplicationId, ct);
        if (app?.Candidate is null || app.JobPosting is null) return (null, "Başvuru bulunamadı");
        if (PipelineRules.IsTerminal(app.Status)) return (null, "Sonuçlanmış başvuruya teklif yapılamaz");
        if (app.Candidate.AnonymizedAt is not null) return (null, "Anonimleştirilmiş adaya teklif yapılamaz");
        var title = b.PositionTitle?.Trim() ?? "";
        if (title.Length is < 2 or > 200) return (null, "Pozisyon adı 2-200 karakter olmalı");
        if (b.GrossSalary is <= 0 or > 100_000_000) return (null, "Brüt ücret geçersiz");
        if (!Currencies.Contains((b.Currency ?? "TRY").ToUpperInvariant())) return (null, "Para birimi TRY, USD, EUR ya da GBP olmalı");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (b.StartDate < today) return (null, "İşe başlama tarihi geçmişte olamaz");
        if (b.ExpiresAt < today) return (null, "Teklif geçerlilik tarihi geçmişte olamaz");
        if (b.Benefits is { Length: > 2000 }) return (null, "Yan haklar en fazla 2000 karakter olabilir");
        return (app, null);
    }

    private async Task<string> RenderAsync(Application app, OfferInput b, CancellationToken ct)
    {
        var company = (await _db.TenantAsync(Tenant, ct))?.Name ?? Tenant;
        return OfferRules.Render(await TemplateAsync(ct), OfferRules.Values(
            $"{app.Candidate!.FirstName} {app.Candidate.LastName}", b.PositionTitle!.Trim(), b.GrossSalary, (b.Currency ?? "TRY").ToUpperInvariant(),
            b.StartDate, b.Benefits, b.ExpiresAt, company, DateOnly.FromDateTime(DateTime.UtcNow)));
    }

    /// <summary>Kaydetmeden mektup önizlemesi.</summary>
    [HttpPost("preview")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Preview([FromBody] OfferInput body, CancellationToken ct)
    {
        var (app, error) = await ValidateAsync(body, ct);
        if (error is not null) return BadRequest(new { message = error });
        return Ok(new { letterText = await RenderAsync(app!, body, ct) });
    }

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create([FromBody] OfferInput body, CancellationToken ct)
    {
        var (app, error) = await ValidateAsync(body, ct);
        if (error is not null) return BadRequest(new { message = error });
        if (await _db.Offers.AnyAsync(o => o.ApplicationId == app!.Id
                && (o.Status == OfferStatus.PendingApproval || o.Status == OfferStatus.Approved || o.Status == OfferStatus.Sent), ct))
            return Conflict(new { message = "Bu başvuru için açık bir teklif zaten var" });

        var offer = new Offer
        {
            ApplicationId = app!.Id,
            PositionTitle = body.PositionTitle!.Trim(),
            GrossSalary = Math.Round(body.GrossSalary, 2),
            Currency = (body.Currency ?? "TRY").ToUpperInvariant(),
            StartDate = body.StartDate,
            Benefits = string.IsNullOrWhiteSpace(body.Benefits) ? null : body.Benefits.Trim(),
            ExpiresAt = body.ExpiresAt,
            SalaryLetterText = await RenderAsync(app, body, ct),
            CreatedByUserId = RecruitmentSql.UserId(User),
        };

        // Onaycı: ilanın departman başı (işe alım yöneticisi). Yoksa ya da teklifi açan kişinin kendisiyse İK karar verir.
        var me = await MeAsync(ct);
        var head = await _db.DepartmentHeadAsync(Tenant, app.JobPosting!.DepartmentId, ct);
        string? approvalNote = null;
        if (head is { } h && h != me)
        {
            var payload = JsonSerializer.Serialize(new
            {
                offerId = offer.Id, applicationId = app.Id, candidate = $"{app.Candidate!.FirstName} {app.Candidate.LastName}",
                position = offer.PositionTitle, grossSalary = offer.GrossSalary, currency = offer.Currency,
                startDate = offer.StartDate, expiresAt = offer.ExpiresAt,
            });
            // KVKK: konu bildirimlere ve sohbet botuna gider — ücret ve aday adı yazılmaz.
            var (wfId, wfError) = await _workflow.StartAsync(me ?? Guid.Empty, h, $"İş teklifi onayı: {offer.PositionTitle}", payload, ct);
            if (wfId is null) return StatusCode(502, new { message = wfError ?? "Onay akışı başlatılamadı" });
            offer.WorkflowRequestId = wfId;
            offer.ApproverEmployeeId = h;
            approvalNote = "Teklif, işe alım yöneticisinin onayına gönderildi.";
        }
        else approvalNote = "Bu ilan için onaycı (departman başı) bulunamadı; teklif kararını İK verir.";

        _db.Offers.Add(offer);
        if (app.Status is ApplicationStatus.Applied or ApplicationStatus.Screening or ApplicationStatus.Interview)
        {
            app.Status = ApplicationStatus.Offer;
            app.StatusChangedAt = DateTimeOffset.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(new { offer = View(offer, true), approvalNote, hrDecides = offer.WorkflowRequestId is null });
    }

    // ------------------------------------------------------------------ görüntüleme

    private static object View(Offer o, bool withSalary) => new
    {
        o.Id, o.ApplicationId, o.PositionTitle,
        grossSalary = withSalary ? o.GrossSalary : (decimal?)null,
        o.Currency, o.StartDate, o.Benefits, o.ExpiresAt,
        letterText = withSalary ? o.SalaryLetterText : null,
        status = o.Status.ToString(), statusLabel = OfferRules.StatusLabel(o.Status),
        o.WorkflowRequestId, o.ApproverEmployeeId, o.DecidedByEmployeeId, o.DecisionNote, o.DecidedAt, o.SentAt, o.RespondedAt, o.CreatedAt,
        hrDecides = o.WorkflowRequestId is null && o.Status == OfferStatus.PendingApproval,
        salaryVisible = withSalary,
    };

    [HttpGet]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> List([FromQuery] Guid? applicationId, [FromQuery] Guid? jobPostingId, CancellationToken ct)
    {
        var q = _db.Offers.AsNoTracking().AsQueryable();
        if (applicationId is { } a) q = q.Where(o => o.ApplicationId == a);
        if (jobPostingId is { } p)
        {
            var apps = _db.Applications.Where(x => x.JobPostingId == p).Select(x => x.Id);
            q = q.Where(o => apps.Contains(o.ApplicationId));
        }
        var rows = await q.OrderByDescending(o => o.CreatedAt).Take(200).ToListAsync(ct);
        var me = IsHr ? null : await MeAsync(ct);
        var shown = rows.Count(o => IsHr || (me is not null && o.ApproverEmployeeId == me));
        if (shown > 0)
            await _db.AuditAsync(HttpContext, Tenant, "Offer", applicationId?.ToString() ?? jobPostingId?.ToString() ?? "list", "SensitiveViewed",
                new { field = "grossSalary", count = shown }, ct);
        return Ok(rows.Select(o => View(o, IsHr || (me is not null && o.ApproverEmployeeId == me))));
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var o = await _db.Offers.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound(new { message = "Teklif bulunamadı" });
        var me = IsHr ? null : await MeAsync(ct);
        if (!IsHr && (me is null || o.ApproverEmployeeId != me)) return Forbid();
        await _db.AuditAsync(HttpContext, Tenant, "Offer", o.Id.ToString(), "SensitiveViewed", new { field = "grossSalary" }, ct);
        return Ok(View(o, true));
    }

    // ------------------------------------------------------------------ yaşam döngüsü

    public record DecideInput(bool Approve, string? Note);

    /// <summary>Onaycı bulunamayan tekliflerde İK'nın doğrudan kararı.</summary>
    [HttpPost("{id:guid}/decide")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Decide(Guid id, [FromBody] DecideInput body, CancellationToken ct)
    {
        var o = await _db.Offers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound(new { message = "Teklif bulunamadı" });
        if (o.WorkflowRequestId is not null) return Conflict(new { message = "Bu teklif onay akışında; kararı onaycı verir" });
        var error = OfferRules.CheckTransition(o.Status, body.Approve ? OfferStatus.Approved : OfferStatus.Rejected);
        if (error is not null) return Conflict(new { message = error });
        o.Status = body.Approve ? OfferStatus.Approved : OfferStatus.Rejected;
        o.DecidedByUserId = RecruitmentSql.UserId(User);
        o.DecidedByEmployeeId = await MeAsync(ct);
        o.DecisionNote = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim()[..Math.Min(500, body.Note.Trim().Length)];
        o.DecidedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(View(o, true));
    }

    /// <summary>Onaylı teklifi adaya gönderir. E-postada ücret yer almaz; mektup yazdırılıp/iletilir ve
    /// kariyer başvurusu olan aday öz-hizmet bağlantısından görüntüleyip yanıtlayabilir.</summary>
    [HttpPost("{id:guid}/send")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Send(Guid id, CancellationToken ct)
    {
        var o = await _db.Offers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound(new { message = "Teklif bulunamadı" });
        var error = OfferRules.CheckTransition(o.Status, OfferStatus.Sent);
        if (error is not null) return Conflict(new { message = error });
        if (o.ExpiresAt < DateOnly.FromDateTime(DateTime.UtcNow)) return Conflict(new { message = "Teklifin geçerlilik tarihi geçmiş" });
        o.Status = OfferStatus.Sent;
        o.SentAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);

        var app = await _db.Applications.AsNoTracking().Include(a => a.Candidate).FirstOrDefaultAsync(a => a.Id == o.ApplicationId, ct);
        if (app?.Candidate is { AnonymizedAt: null } c)
        {
            var company = (await _db.TenantAsync(Tenant, ct))?.Name ?? Tenant;
            await _db.EmailCandidateAsync(Tenant, c.Email, $"İş teklifi — {company}",
                $"Merhaba {c.FirstName}, {company} size \"{o.PositionTitle}\" pozisyonu için bir iş teklifi iletti. Teklif mektubu {OfferRules.Date(o.ExpiresAt)} tarihine kadar geçerlidir. "
                + (app.SelfServiceTokenHash is not null
                    ? "Mektubu başvurunuzdan sonra size verilen kişisel bağlantıdan görüntüleyip yanıtlayabilirsiniz."
                    : "Mektup İnsan Kaynakları tarafından ayrıca size iletilecektir."),
                "recruitment.offer.sent", ct);
        }
        return Ok(View(o, true));
    }

    public record RespondInput(bool Accept);

    /// <summary>Adayın yanıtını İK kaydeder (aday öz-hizmetten de yanıtlayabilir).</summary>
    [HttpPost("{id:guid}/respond")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Respond(Guid id, [FromBody] RespondInput body, CancellationToken ct)
    {
        var o = await _db.Offers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound(new { message = "Teklif bulunamadı" });
        var app = await _db.Applications.FirstOrDefaultAsync(a => a.Id == o.ApplicationId, ct);
        if (app is null) return NotFound(new { message = "Başvuru bulunamadı" });
        var (error, code) = await RespondCoreAsync(_db, o, app, body.Accept, ct);
        await _db.SaveChangesAsync(ct);
        if (error is not null) return StatusCode(code, new { message = error });
        return Ok(new { offer = View(o, true), applicationStatus = app.Status.ToString() });
    }

    /// <summary>Ortak yanıt mantığı (kaydetmez). Kabulde başvuru "İşe alındı" olur (ilan açıksa).</summary>
    internal static async Task<(string? Error, int Code)> RespondCoreAsync(RecruitmentDbContext db, Offer o, Application app, bool accept, CancellationToken ct)
    {
        var error = OfferRules.CheckTransition(o.Status, accept ? OfferStatus.Accepted : OfferStatus.Declined);
        if (error is not null) return (error, 409);
        if (o.ExpiresAt < DateOnly.FromDateTime(DateTime.UtcNow))
        {
            o.Status = OfferStatus.Expired;
            return ("Teklifin geçerlilik süresi dolmuş", 409);
        }
        o.Status = accept ? OfferStatus.Accepted : OfferStatus.Declined;
        o.RespondedAt = DateTimeOffset.UtcNow;
        if (accept)
        {
            var posting = await db.JobPostings.AsNoTracking().FirstOrDefaultAsync(p => p.Id == app.JobPostingId, ct);
            if (app.Status != ApplicationStatus.Offer && !PipelineRules.IsTerminal(app.Status))
            {
                app.Status = ApplicationStatus.Offer;
                app.StatusChangedAt = DateTimeOffset.UtcNow;
            }
            if (PipelineRules.CheckMove(app.Status, ApplicationStatus.Hired, posting is null || posting.Status == JobPostingStatus.Closed) is null)
            {
                app.Status = ApplicationStatus.Hired;
                app.StatusChangedAt = DateTimeOffset.UtcNow;
            }
        }
        return (null, 200);
    }

    [HttpPost("{id:guid}/withdraw")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Withdraw(Guid id, CancellationToken ct)
    {
        var o = await _db.Offers.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (o is null) return NotFound(new { message = "Teklif bulunamadı" });
        var error = OfferRules.CheckTransition(o.Status, OfferStatus.Withdrawn);
        if (error is not null) return Conflict(new { message = error });
        o.Status = OfferStatus.Withdrawn;
        await _db.SaveChangesAsync(ct);
        return Ok(View(o, true));
    }
}
