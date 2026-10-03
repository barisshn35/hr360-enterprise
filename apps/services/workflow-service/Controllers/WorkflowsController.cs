using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowService.Data;
using WorkflowService.Models;
using WorkflowService.Messaging;
using WorkflowService.Services;
using System.Text.Json;

namespace WorkflowService.Controllers;

[ApiController]
[Route("api/workflows")]
[Authorize]
public class WorkflowsController : ControllerBase
{
    private readonly WorkflowDbContext _db;
    private readonly EmployeeDirectoryClient _employees;

    public WorkflowsController(WorkflowDbContext db, EmployeeDirectoryClient employees)
    {
        _db = db;
        _employees = employees;
    }

    /// <summary>Tum is akislarini gorebilen/yonetebilen roller.</summary>
    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin");

    /// <summary>
    /// GUVENLIK: Liste/detay/gecikenler onceden yalnizca [Authorize] ile korunuyordu -
    /// her calisan kiracidaki TUM taleplerin konusunu ve payload'unu gorebiliyordu
    /// (ornegin "5 gunluk Sick talebi" = saglik bilgisi; canli dogrulandi). Artik
    /// IK rolleri disindakiler yalnizca talep sahibi, onaycisi ya da vekili
    /// olduklari akislari gorur. Kimlik cozulemezse bos/403 (fail-closed).
    /// </summary>
    private IQueryable<WorkflowRequest> VisibleTo(IQueryable<WorkflowRequest> q, Guid me) =>
        q.Where(w => w.RequesterEmployeeId == me
            || w.Steps.Any(s => s.ApproverEmployeeId == me || s.DelegatedToEmployeeId == me));

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] WorkflowStatus? status, [FromQuery] Guid? requesterId, CancellationToken ct)
    {
        var query = _db.WorkflowRequests.Include(w => w.Steps).AsQueryable();
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            query = VisibleTo(query, me.Value);
        }
        if (status.HasValue) query = query.Where(w => w.Status == status.Value);
        if (requesterId.HasValue) query = query.Where(w => w.RequesterEmployeeId == requesterId.Value);
        return Ok(await query.OrderByDescending(w => w.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var q = _db.WorkflowRequests.Include(w => w.Steps.OrderBy(s => s.Order)).AsQueryable();
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            q = VisibleTo(q, me.Value);
        }
        var wf = await q.FirstOrDefaultAsync(w => w.Id == id, ct);
        return wf is null ? NotFound() : Ok(wf);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateWorkflowRequest request, CancellationToken ct)
    {
        // GUVENLIK: Talep eden ve onaycilar tamamen istemciden geliyordu. Bir
        // yonetici "talep eden = bir meslektas, onayci = kendisi" olan sahte bir
        // akis acip kendi masraf beyanina baglayarak KENDI beyanini onaylayabiliyordu
        // (canli dogrulandi: 49.999 TL). Artik IK rolleri disinda talep eden
        // HER ZAMAN cagiranin kendisidir; onaycilar dogrulanir.
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            if (request.RequesterEmployeeId != me.Value)
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "Yalnızca kendi adınıza talep oluşturabilirsiniz" });
        }
        var (error, wf) = await CreateCoreAsync(request, ct);
        return error ?? CreatedAtAction(nameof(GetById), new { id = wf!.Id }, wf);
    }

    /// <summary>
    /// Servisler arası (jetonsuz) akış başlatma: sohbet botundan açılan izin talebi gibi.
    /// Web ucuyla aynı doğrulamalar uygulanır; talep eden gövdeden gelir (çağıran servis
    /// kişiyi doğrulamıştır). Gateway /api/*/internal/ yollarını dışarıya kapatır.
    /// </summary>
    [HttpPost("/api/internal/workflows")]
    [AllowAnonymous]
    public async Task<IActionResult> CreateInternal([FromBody] InternalCreateWorkflowRequest request,
        [FromServices] Tenancy.TenantContext tenant, CancellationToken ct)
    {
        var expected = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_TOKEN");
        var given = Request.Headers["X-Internal-Token"].FirstOrDefault() ?? "";
        if (string.IsNullOrEmpty(expected)
            || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(given)))
            return NotFound();
        if (string.IsNullOrWhiteSpace(request.TenantSlug)) return BadRequest(new { message = "Kiracı belirtilmedi" });
        tenant.TenantSlug = request.TenantSlug;
        tenant.IsPlatformAdmin = false;
        var (error, wf) = await CreateCoreAsync(new CreateWorkflowRequest(request.Type, request.RequesterEmployeeId, request.Subject,
            request.Payload, request.ApproverEmployeeIds ?? new List<Guid>(), request.SlaHours), ct);
        return error ?? Ok(new { wf!.Id });
    }

    private async Task<(IActionResult? Error, WorkflowRequest? Wf)> CreateCoreAsync(CreateWorkflowRequest request, CancellationToken ct)
    {
        var approvers = request.ApproverEmployeeIds ?? new List<Guid>();
        if (approvers.Count == 0 || approvers.Count > 10)
            return (BadRequest(new { message = "En az 1, en fazla 10 onaycı gerekli" }), null);
        if (approvers.Contains(Guid.Empty) || approvers.Distinct().Count() != approvers.Count)
            return (BadRequest(new { message = "Onaycı listesi geçersiz ya da tekrar içeriyor" }), null);
        if (approvers.Contains(request.RequesterEmployeeId))
            return (BadRequest(new { message = "Talep eden kendi talebinin onaycısı olamaz" }), null);
        if (request.SlaHours is < 1 or > 24 * 90)
            return (BadRequest(new { message = "SLA 1 saat ile 90 gün arasında olmalı" }), null);
        if (request.Subject is { Length: > 300 })
            return (BadRequest(new { message = "Konu en fazla 300 karakter olabilir" }), null);

        var wf = new WorkflowRequest
        {
            Type = request.Type,
            RequesterEmployeeId = request.RequesterEmployeeId,
            Subject = request.Subject,
            Payload = request.Payload,
            SlaDueAt = request.SlaHours.HasValue
                ? DateTimeOffset.UtcNow.AddHours(request.SlaHours.Value)
                : null
        };

        int order = 1;
        foreach (var approverId in approvers)
        {
            wf.Steps.Add(new ApprovalStep
            {
                Order = order++,
                ApproverEmployeeId = approverId
            });
        }

        _db.WorkflowRequests.Add(wf);

        // Ilk adimin onaycisina "karar bekleyen bir talebiniz var" e-postasi.
        // Sirali onay oldugu icin SADECE ilk adim su an aktif - sonraki
        // adimlarin onaycilari kendi siralari geldiginde (Decide metodunda)
        // bilgilendirilir.
        var firstStep = wf.Steps.OrderBy(s => s.Order).FirstOrDefault();
        if (firstStep is not null)
        {
            var approver = await LookupEmployeeAsync(firstStep.ApproverEmployeeId, ct);
            var requester = await LookupEmployeeAsync(request.RequesterEmployeeId, ct);
            if (approver is not null)
            {
                _db.OutboxMessages.Add(new OutboxMessage
                {
                    Topic = WorkflowTopics.Events,
                    EventType = WorkflowEventTypes.Submitted,
                    PartitionKey = wf.Id.ToString(),
                    Payload = JsonSerializer.Serialize(new WorkflowSubmittedEvent(
                        _db.CurrentTenantSlug ?? "",
                        wf.Id, wf.Type.ToString(), wf.RequesterEmployeeId,
                        requester is null ? null : $"{requester.FirstName} {requester.LastName}",
                        wf.Subject, firstStep.ApproverEmployeeId,
                        approver.Email, approver.FirstName, wf.SlaDueAt, DateTimeOffset.UtcNow)),
                });
            }
        }

        await _db.SaveChangesAsync(ct);
        return (null, wf);
    }

    [HttpPost("{id}/steps/{stepId}/decide")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Decide(Guid id, Guid stepId, [FromBody] DecideRequest request, CancellationToken ct)
    {
        // NOT: Onceden "Delegated"/"Pending" da kabul ediliyordu - "Delegated" adimi
        // karar verilmis sayip onaylamadan birakiyor, akis bir daha asla
        // tamamlanamiyordu. Karar yalnizca Onay ya da Red olabilir.
        if (request.Decision is not (StepDecision.Approved or StepDecision.Rejected))
            return BadRequest(new { message = "Karar yalnızca Approved ya da Rejected olabilir" });

        var wf = await _db.WorkflowRequests.Include(w => w.Steps).FirstOrDefaultAsync(w => w.Id == id);
        if (wf is null) return NotFound("Workflow not found");
        if (wf.Status != WorkflowStatus.Pending) return BadRequest("Workflow is not pending");

        var step = wf.Steps.FirstOrDefault(s => s.Id == stepId);
        if (step is null) return NotFound("Step not found");
        if (step.Decision != StepDecision.Pending) return BadRequest("Step already decided");

        // GUVENLIK: RequireManagerOrAbove tek basina "bu adima atanan kisi
        // bu mu" sorusunu cevaplamiyor - herhangi bir manager+ rolundeki
        // kullanici, baskasina (hatta kendi actigi talebe) atanmis bir
        // adimi karara baglayabiliyordu. Simdi, karari veren kullanicinin
        // GERCEKTEN step.ApproverEmployeeId'ye esit olmasi gerekiyor;
        // hr-admin/tenant-admin/platform-admin bu kontrolu (Devret
        // ozelligine benzer sekilde, idari mudahale icin) gecebilir -
        // AMA "kendi actigi talebi kendi karara baglayamaz" kurali hicbir
        // rol icin istisna degildir. Bu iki kontrol kasitli olarak ayri:
        // ilk denemede tam bu ayrimi atlamistim - tenant-admin override'i,
        // RequesterEmployeeId kontrolunden ONCE calisip kendi talebini
        // reddedebiliyordu.
        //
        // FAIL-CLOSED: myEmployeeId null donerse (employee-service'e
        // erisilemedi ya da /me kaydi yok) REDDEDILIR, kontrol atlanmaz.
        // Ilk denemede "null ise kontrolu atla" yazmistim - bu, gercek
        // veride JWT email'i ile employee kaydi email'i uyusmadiginda
        // (bkz. FindMyEmployeeIdAsync yorumu, artik /me kullaniyor) sessizce
        // acik kapi birakiyordu; bugun canli ortamda iki kez dogrulandi.
        var myEmployeeId = await _employees.FindMyEmployeeIdAsync(ct);
        if (myEmployeeId is null || myEmployeeId.Value == wf.RequesterEmployeeId)
            return Forbid();

        var isAdminOverride = User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
            || User.IsInRole("platform-admin");
        // Vekalet: adim baskasina devredildiyse vekil de karar verebilir (onceden
        // DelegatedToEmployeeId hic okunmuyordu, devretme ozelligi calismiyordu).
        if (!isAdminOverride && myEmployeeId.Value != step.ApproverEmployeeId
            && myEmployeeId.Value != step.DelegatedToEmployeeId)
            return Forbid();

        var error = await ApplyDecisionAsync(wf, step, request.Decision, request.Comment, myEmployeeId.Value, ct);
        if (error is not null) return BadRequest(error);
        await _db.SaveChangesAsync();
        return Ok(wf);
    }

    /// <summary>
    /// Servisler arasi karar ucu: Slack/Teams'teki "Onayla/Reddet" dugmeleri
    /// governance-service uzerinden buraya gelir. Kullanici jetonu yoktur; cagri
    /// INTERNAL_SERVICE_TOKEN ile dogrulanir ve karari veren kisi (sohbet
    /// hesabi e-postayla eslesmis calisan) govdede gelir.
    ///
    /// GUVENLIK: Web ucundaki kurallarin aynisi uygulanir, istisnasiz:
    /// karar veren adimin onaycisi ya da vekili olmali, kendi talebini karara
    /// baglayamaz. IK/yonetici "idari mudahale" istisnasi burada YOKTUR (sohbet
    /// hesabinin rolleri bilinmez). Gateway /api/*/internal/ yollarini disariya
    /// kapatir; anahtar tanimli degilse uc tamamen kapalidir.
    /// </summary>
    [HttpPost("/api/internal/workflows/{id}/steps/{stepId}/decide")]
    [AllowAnonymous]
    public async Task<IActionResult> DecideInternal(Guid id, Guid stepId, [FromBody] InternalDecideRequest request,
        [FromServices] Tenancy.TenantContext tenant, CancellationToken ct)
    {
        var expected = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_TOKEN");
        var given = Request.Headers["X-Internal-Token"].FirstOrDefault() ?? "";
        if (string.IsNullOrEmpty(expected)
            || !System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                System.Text.Encoding.UTF8.GetBytes(expected), System.Text.Encoding.UTF8.GetBytes(given)))
            return NotFound();
        if (string.IsNullOrWhiteSpace(request.TenantSlug)) return BadRequest(new { message = "Kiracı belirtilmedi" });
        if (request.Decision is not (StepDecision.Approved or StepDecision.Rejected))
            return BadRequest(new { message = "Karar yalnızca Approved ya da Rejected olabilir" });

        tenant.TenantSlug = request.TenantSlug;
        tenant.IsPlatformAdmin = false;

        var wf = await _db.WorkflowRequests.Include(w => w.Steps).FirstOrDefaultAsync(w => w.Id == id, ct);
        if (wf is null) return NotFound(new { message = "Talep bulunamadı", code = "not_found" });
        var step = wf.Steps.FirstOrDefault(s => s.Id == stepId);
        if (step is null) return NotFound(new { message = "Onay adımı bulunamadı", code = "not_found" });
        if (wf.Status != WorkflowStatus.Pending || step.Decision != StepDecision.Pending)
            return Conflict(new { message = "Bu talep zaten karara bağlanmış.", code = "already_decided", status = wf.Status.ToString() });
        if (request.ActorEmployeeId == wf.RequesterEmployeeId)
            return StatusCode(403, new { message = "Kendi talebinizi onaylayamazsınız.", code = "forbidden" });
        if (request.ActorEmployeeId != step.ApproverEmployeeId && request.ActorEmployeeId != step.DelegatedToEmployeeId)
            return StatusCode(403, new { message = "Bu adımın onaycısı siz değilsiniz.", code = "forbidden" });

        var comment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim();
        if (request.Channel is { Length: > 0 } ch) comment = comment is null ? $"({ch} üzerinden)" : $"{comment} ({ch} üzerinden)";
        var error = await ApplyDecisionAsync(wf, step, request.Decision, comment, request.ActorEmployeeId, ct);
        if (error is not null) return Conflict(new { message = "Önceki onay adımları henüz tamamlanmadı.", code = "previous_pending" });
        await _db.SaveChangesAsync(ct);
        return Ok(new { wf.Id, status = wf.Status.ToString(), wf.Subject, stepOrder = step.Order });
    }

    /// <summary>
    /// Calisan adi/e-postasi. Web isteginde kullanicinin jetonuyla employee-service'e
    /// sorulur; servisler arasi (jetonsuz) cagride ayni veritabanindaki tablodan,
    /// kiraci filtresiyle okunur.
    /// </summary>
    private async Task<EmployeeDirectoryClient.EmployeeDto?> LookupEmployeeAsync(Guid id, CancellationToken ct)
    {
        if (!string.IsNullOrEmpty(Request.Headers.Authorization.ToString()))
            return await _employees.GetByIdAsync(id, ct);
        var tenant = _db.CurrentTenantSlug ?? "";
        var row = await _db.Database
            .SqlQuery<EmployeeRow>($"SELECT \"Id\", \"FirstName\", \"LastName\", \"Email\" FROM employee_employees WHERE \"Id\" = {id} AND \"TenantSlug\" = {tenant}")
            .FirstOrDefaultAsync(ct);
        return row is null ? null : new EmployeeDirectoryClient.EmployeeDto(row.Id, row.FirstName, row.LastName, row.Email);
    }

    private sealed class EmployeeRow
    {
        public Guid Id { get; set; }
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public string Email { get; set; } = "";
    }

    /// <summary>Yetki kontrolleri yapildiktan sonra karari uygular (kaydetmez). Hata metni ya da null.</summary>
    private async Task<string?> ApplyDecisionAsync(WorkflowRequest wf, ApprovalStep step, StepDecision decision, string? comment,
        Guid actorEmployeeId, CancellationToken ct)
    {
        var request = new DecideRequest(decision, comment);
        var myEmployeeId = (Guid?)actorEmployeeId;
        // Sirali onay: onceki adimlar tamamlanmadan bu adim karar veremez
        var previousPending = wf.Steps.Any(s => s.Order < step.Order && s.Decision == StepDecision.Pending);
        if (previousPending) return "Previous steps are still pending";

        step.Decision = request.Decision;
        step.Comment = request.Comment;
        step.DecidedAt = DateTimeOffset.UtcNow;

        if (request.Decision == StepDecision.Rejected)
        {
            wf.Status = WorkflowStatus.Rejected;
            wf.CompletedAt = DateTimeOffset.UtcNow;
        }
        else if (request.Decision == StepDecision.Approved)
        {
            var allApproved = wf.Steps.All(s => s.Decision == StepDecision.Approved);
            if (allApproved)
            {
                wf.Status = WorkflowStatus.Approved;
                wf.CompletedAt = DateTimeOffset.UtcNow;
            }
            else
            {
                // Sira bir sonraki adima gecti - o adimin onaycisina
                // "karar bekleyen bir talebiniz var" bildirimi gonder.
                var nextStep = wf.Steps
                    .Where(s => s.Order > step.Order && s.Decision == StepDecision.Pending)
                    .OrderBy(s => s.Order)
                    .FirstOrDefault();
                if (nextStep is not null)
                {
                    var approver = await LookupEmployeeAsync(nextStep.ApproverEmployeeId, ct);
                    var requester = await LookupEmployeeAsync(wf.RequesterEmployeeId, ct);
                    if (approver is not null)
                    {
                        _db.OutboxMessages.Add(new OutboxMessage
                        {
                            Topic = WorkflowTopics.Events,
                            EventType = WorkflowEventTypes.Submitted,
                            PartitionKey = wf.Id.ToString(),
                            Payload = JsonSerializer.Serialize(new WorkflowSubmittedEvent(
                                _db.CurrentTenantSlug ?? "",
                                wf.Id, wf.Type.ToString(), wf.RequesterEmployeeId,
                                requester is null ? null : $"{requester.FirstName} {requester.LastName}",
                                wf.Subject, nextStep.ApproverEmployeeId,
                                approver.Email, approver.FirstName, wf.SlaDueAt, DateTimeOffset.UtcNow)),
                        });
                    }
                }
            }
        }

        // Akis sonuclandiysa event yayinla: talebi baslatan servisler
        // (leave, expense) bunu dinleyip kendi kaydini kapatir.
        if (wf.Status is WorkflowStatus.Approved or WorkflowStatus.Rejected)
        {
            _db.OutboxMessages.Add(new OutboxMessage
            {
                Topic = WorkflowTopics.Events,
                EventType = wf.Status == WorkflowStatus.Approved
                    ? WorkflowEventTypes.Approved
                    : WorkflowEventTypes.Rejected,
                PartitionKey = wf.Id.ToString(),
                Payload = JsonSerializer.Serialize(new WorkflowDecidedEvent(
                    _db.CurrentTenantSlug ?? "",
                    wf.Id, wf.Type.ToString(), wf.RequesterEmployeeId, wf.Subject,
                    wf.Status == WorkflowStatus.Approved,
                    // Denetim izi: karari GERCEKTEN veren kisi (vekil ya da IK
                    // mudahalesi olabilir) - onceden adimin atanmis onaycisi yaziliyordu.
                    myEmployeeId.Value, step.Comment, DateTimeOffset.UtcNow)),
            });
        }

        return null;
    }

    /// <summary>
    /// Bekleyen akisi iptal eder - talep sahibi (izin talebini iptal ettiginde
    /// leave-service onun jetonuyla cagirir) ya da IK. Onceden iptal ucu yoktu: iptal edilen
    /// iznin akisi onaycinin kutusunda acik kaliyordu.
    /// </summary>
    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
    {
        var wf = await _db.WorkflowRequests.FirstOrDefaultAsync(w => w.Id == id, ct);
        if (wf is null) return NotFound();
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != wf.RequesterEmployeeId) return NotFound();
        }
        if (wf.Status != WorkflowStatus.Pending)
            return BadRequest(new { message = "Yalnızca bekleyen talep iptal edilebilir" });
        wf.Status = WorkflowStatus.Cancelled;
        wf.CompletedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(wf);
    }

    [HttpPost("{id}/steps/{stepId}/delegate")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Delegate(Guid id, Guid stepId, [FromBody] DelegateRequest request, CancellationToken ct)
    {
        var wf = await _db.WorkflowRequests.Include(w => w.Steps).FirstOrDefaultAsync(w => w.Id == id, ct);
        if (wf is null) return NotFound("Workflow not found");
        var step = wf.Steps.FirstOrDefault(s => s.Id == stepId);
        if (step is null) return NotFound("Step not found");
        if (wf.Status != WorkflowStatus.Pending) return BadRequest("Workflow is not pending");
        if (step.Decision != StepDecision.Pending) return BadRequest("Step already decided");

        // GUVENLIK: Onceden herhangi bir yonetici, kendisine ait olmayan herhangi bir
        // adimi istedigi kisiye (kendisine dahil) devredebiliyordu. Artik yalnizca
        // adimin onaycisi ya da IK devredebilir; talep sahibine devredilemez.
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != step.ApproverEmployeeId) return Forbid();
            if (request.DelegateToEmployeeId == me.Value)
                return BadRequest(new { message = "Adımı kendinize devredemezsiniz" });
        }
        if (request.DelegateToEmployeeId == Guid.Empty || request.DelegateToEmployeeId == wf.RequesterEmployeeId)
            return BadRequest(new { message = "Adım talep sahibine devredilemez" });

        step.DelegatedToEmployeeId = request.DelegateToEmployeeId;
        step.Comment = request.Comment;
        await _db.SaveChangesAsync();
        return Ok(step);
    }

    [HttpGet("overdue")]
    public async Task<IActionResult> GetOverdue(CancellationToken ct)
    {
        var now = DateTimeOffset.UtcNow;
        var q = _db.WorkflowRequests.AsQueryable();
        if (!IsHr)
        {
            var me = await _employees.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            q = VisibleTo(q, me.Value);
        }
        var overdue = await q
            .Where(w => w.Status == WorkflowStatus.Pending && w.SlaDueAt != null && w.SlaDueAt < now)
            .Include(w => w.Steps)
            .ToListAsync();
        return Ok(overdue);
    }
}

public record CreateWorkflowRequest(
    WorkflowType Type,
    Guid RequesterEmployeeId,
    string? Subject,
    string? Payload,
    List<Guid> ApproverEmployeeIds,
    int? SlaHours);

public record DecideRequest(StepDecision Decision, string? Comment);
public record InternalCreateWorkflowRequest(string TenantSlug, WorkflowType Type, Guid RequesterEmployeeId, string? Subject, string? Payload,
    List<Guid>? ApproverEmployeeIds, int? SlaHours);
public record InternalDecideRequest(string TenantSlug, Guid ActorEmployeeId, StepDecision Decision, string? Comment, string? Channel);
public record DelegateRequest(Guid DelegateToEmployeeId, string? Comment);
