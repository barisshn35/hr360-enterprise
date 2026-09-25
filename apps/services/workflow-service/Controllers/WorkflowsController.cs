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

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] WorkflowStatus? status, [FromQuery] Guid? requesterId)
    {
        var query = _db.WorkflowRequests.Include(w => w.Steps).AsQueryable();
        if (status.HasValue) query = query.Where(w => w.Status == status.Value);
        if (requesterId.HasValue) query = query.Where(w => w.RequesterEmployeeId == requesterId.Value);
        return Ok(await query.OrderByDescending(w => w.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var wf = await _db.WorkflowRequests.Include(w => w.Steps.OrderBy(s => s.Order))
            .FirstOrDefaultAsync(w => w.Id == id);
        return wf is null ? NotFound() : Ok(wf);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateWorkflowRequest request, CancellationToken ct)
    {
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
        foreach (var approverId in request.ApproverEmployeeIds)
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
            var approver = await _employees.GetByIdAsync(firstStep.ApproverEmployeeId, ct);
            var requester = await _employees.GetByIdAsync(request.RequesterEmployeeId, ct);
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

        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = wf.Id }, wf);
    }

    [HttpPost("{id}/steps/{stepId}/decide")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Decide(Guid id, Guid stepId, [FromBody] DecideRequest request, CancellationToken ct)
    {
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
        if (!isAdminOverride && myEmployeeId.Value != step.ApproverEmployeeId)
            return Forbid();

        // Sirali onay: onceki adimlar tamamlanmadan bu adim karar veremez
        var previousPending = wf.Steps.Any(s => s.Order < step.Order && s.Decision == StepDecision.Pending);
        if (previousPending) return BadRequest("Previous steps are still pending");

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
                    var approver = await _employees.GetByIdAsync(nextStep.ApproverEmployeeId, ct);
                    var requester = await _employees.GetByIdAsync(wf.RequesterEmployeeId, ct);
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
                    step.ApproverEmployeeId, step.Comment, DateTimeOffset.UtcNow)),
            });
        }

        await _db.SaveChangesAsync();
        return Ok(wf);
    }

    [HttpPost("{id}/steps/{stepId}/delegate")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Delegate(Guid id, Guid stepId, [FromBody] DelegateRequest request)
    {
        var step = await _db.ApprovalSteps.FirstOrDefaultAsync(s => s.Id == stepId && s.WorkflowRequestId == id);
        if (step is null) return NotFound("Step not found");
        if (step.Decision != StepDecision.Pending) return BadRequest("Step already decided");

        step.DelegatedToEmployeeId = request.DelegateToEmployeeId;
        step.Comment = request.Comment;
        await _db.SaveChangesAsync();
        return Ok(step);
    }

    [HttpGet("overdue")]
    public async Task<IActionResult> GetOverdue()
    {
        var now = DateTimeOffset.UtcNow;
        var overdue = await _db.WorkflowRequests
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
public record DelegateRequest(Guid DelegateToEmployeeId, string? Comment);
