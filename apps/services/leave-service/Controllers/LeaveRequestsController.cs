using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Models;
using LeaveService.Services;

namespace LeaveService.Controllers;

[ApiController]
[Route("api/leave-requests")]
[Authorize]
public class LeaveRequestsController : ControllerBase
{
    private readonly LeaveDbContext _db;
    private readonly ApprovalWorkflowClient _approvals;
    public LeaveRequestsController(LeaveDbContext db, ApprovalWorkflowClient approvals)
    {
        _db = db;
        _approvals = approvals;
    }

    /// <summary>
    /// Izin taleplerini listeler.
    ///
    /// GUVENLIK: bu uc AUTH_ONLY'ydi ve employeeId filtresi disaridan
    /// serbestce verilebiliyordu - "employee" rolundeki bir kullanici
    /// employeeId'yi degistirerek BASKA HERHANGI BIR calisanin izin
    /// taleplerini (tarih, gerekce dahil) gorebiliyordu, hic vermeden de
    /// TUM sirketin taleplerini cekebiliyordu. performance-service/
    /// GoalsController'daki ayni desenle simdi:
    ///   - Yonetici ve ustu: istedigi employeeId'yi (ya da hicbirini)
    ///     sorgulayabilir.
    ///   - Calisan: yalnizca KENDI employeeId'sini sorgulayabilir; farkli
    ///     bir ID verirse ya da hic vermezse 403 doner.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] LeaveRequestStatus? status, CancellationToken ct)
    {
        var isManager = User.IsInRole("manager") || User.IsInRole("hr-admin")
            || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin");

        if (!isManager)
        {
            var myEmployeeId = await _approvals.FindMyEmployeeIdAsync(ct);
            if (myEmployeeId is null) return Forbid();
            if (employeeId.HasValue && employeeId.Value != myEmployeeId.Value) return Forbid();
            employeeId = myEmployeeId;
        }

        var q = _db.LeaveRequests.AsQueryable();
        if (employeeId.HasValue) q = q.Where(r => r.EmployeeId == employeeId.Value);
        if (status.HasValue) q = q.Where(r => r.Status == status.Value);
        return Ok(await q.OrderByDescending(r => r.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var r = await _db.LeaveRequests.FirstOrDefaultAsync(x => x.Id == id);
        return r is null ? NotFound() : Ok(r);
    }

    /// <summary>Izin talebi olusturur, bakiyeden 'beklemede' olarak duser ve
    /// calisanin departman basina onay icin bir workflow acar.</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateLeaveRequest request, CancellationToken ct)
    {
        if (request.EndDate < request.StartDate)
            return BadRequest("Bitis tarihi baslangictan once olamaz");

        var days = request.Days > 0
            ? request.Days
            : request.EndDate.DayNumber - request.StartDate.DayNumber + 1;

        var balance = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == request.EmployeeId &&
            b.Year == request.StartDate.Year &&
            b.Type == request.Type);

        if (balance is not null && balance.RemainingDays < days)
            return BadRequest($"Yetersiz bakiye. Kalan: {balance.RemainingDays} gun");

        var leave = new LeaveRequest
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Days = days,
            Reason = request.Reason,
            Status = LeaveRequestStatus.Submitted,
            WorkflowRequestId = request.WorkflowRequestId
        };

        if (balance is not null)
        {
            balance.PendingDays += days;
            balance.UpdatedAt = DateTimeOffset.UtcNow;
        }

        _db.LeaveRequests.Add(leave);
        await _db.SaveChangesAsync();

        // Departman basina onay workflow'u ac - bulunamazsa (bas atanmamis,
        // cross-service cagri hatasi) talep yine de Submitted olarak kalir
        // ve mevcut /resolve ucuyla elle sonuclandirilabilir.
        var workflowId = await _approvals.StartLeaveApprovalAsync(
            leave.EmployeeId,
            $"{days} günlük {leave.Type} talebi ({leave.StartDate:dd.MM.yyyy} - {leave.EndDate:dd.MM.yyyy})",
            ct);
        if (workflowId is not null)
        {
            leave.WorkflowRequestId = workflowId;
            await _db.SaveChangesAsync();
        }

        return CreatedAtAction(nameof(GetById), new { id = leave.Id }, leave);
    }

    /// <summary>Workflow karari sonrasi talebi sonuclandirir ve bakiyeyi kesinlestirir.</summary>
    [HttpPost("{id}/resolve")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveLeaveRequest request, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(x => x.Id == id);
        if (leave is null) return NotFound();
        if (leave.Status != LeaveRequestStatus.Submitted)
            return BadRequest("Yalnızca onay bekleyen talepler sonuçlandırılabilir");

        // GUVENLIK: bu uc, workflow-service'teki asil onay akisi
        // basarisiz olursa diye birakilan elle-sonuclandirma yolu (bkz.
        // Create yorumu) - ama RequireManagerOrAbove tek basina "sen bu
        // talebin sahibi misin" sorusunu cevaplamiyordu. Departman bazli
        // tam yetki kontrolu icin workflow-service'e bagimli olmadan, en
        // azindan en bariz acigi (kendi talebini kendi onaylama/reddetme)
        // kapatiyoruz.
        var myEmployeeId = await _approvals.FindMyEmployeeIdAsync(ct);
        if (myEmployeeId is null || myEmployeeId.Value == leave.EmployeeId)
            return Forbid();

        var balance = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == leave.EmployeeId &&
            b.Year == leave.StartDate.Year &&
            b.Type == leave.Type);

        if (balance is not null)
        {
            balance.PendingDays -= leave.Days;
            if (request.Approved) balance.UsedDays += leave.Days;
            balance.UpdatedAt = DateTimeOffset.UtcNow;
        }

        leave.Status = request.Approved ? LeaveRequestStatus.Approved : LeaveRequestStatus.Rejected;
        leave.DecidedAt = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(leave);
    }

    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(Guid id)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(x => x.Id == id);
        if (leave is null) return NotFound();
        if (leave.Status is LeaveRequestStatus.Approved or LeaveRequestStatus.Rejected)
            return BadRequest("Sonuçlanmış talep iptal edilemez");

        var balance = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == leave.EmployeeId &&
            b.Year == leave.StartDate.Year &&
            b.Type == leave.Type);

        if (balance is not null && leave.Status == LeaveRequestStatus.Submitted)
        {
            balance.PendingDays -= leave.Days;
            balance.UpdatedAt = DateTimeOffset.UtcNow;
        }

        leave.Status = LeaveRequestStatus.Cancelled;
        await _db.SaveChangesAsync();
        return Ok(leave);
    }
}

public record CreateLeaveRequest(
    Guid EmployeeId, LeaveType Type, DateOnly StartDate, DateOnly EndDate,
    decimal Days, string? Reason, Guid? WorkflowRequestId);

public record ResolveLeaveRequest(bool Approved);
