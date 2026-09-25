using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Models;
using ExpenseService.Services;

namespace ExpenseService.Controllers;

[ApiController]
[Route("api/expense-claims")]
[Authorize]
public class ExpenseClaimsController : ControllerBase
{
    private readonly ExpenseDbContext _db;
    private readonly ApprovalWorkflowClient _approvals;
    public ExpenseClaimsController(ExpenseDbContext db, ApprovalWorkflowClient approvals)
    {
        _db = db;
        _approvals = approvals;
    }

    /// <summary>
    /// Masraf beyanlarini listeler.
    ///
    /// GUVENLIK: bu uc AUTH_ONLY'ydi ve employeeId filtresi disaridan
    /// serbestce verilebiliyordu - "employee" rolundeki bir kullanici
    /// employeeId'yi degistirerek BASKA HERHANGI BIR calisanin masraf
    /// beyanlarini (tutar, kalem detayi dahil) gorebiliyordu, hic vermeden
    /// de TUM sirketin beyanlarini cekebiliyordu. performance-service/
    /// GoalsController'daki ayni desenle simdi:
    ///   - Yonetici ve ustu (ve Muhasebe - odeme isaretlemek icin tum
    ///     beyanlari gormesi gerekiyor): istedigi employeeId'yi (ya da
    ///     hicbirini) sorgulayabilir.
    ///   - Calisan: yalnizca KENDI employeeId'sini sorgulayabilir; farkli
    ///     bir ID verirse ya da hic vermezse 403 doner.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] ClaimStatus? status, CancellationToken ct)
    {
        var isPrivileged = User.IsInRole("manager") || User.IsInRole("hr-admin")
            || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin")
            || User.IsInRole("accounting");

        if (!isPrivileged)
        {
            var myEmployeeId = await _approvals.FindMyEmployeeIdAsync(ct);
            if (myEmployeeId is null) return Forbid();
            if (employeeId.HasValue && employeeId.Value != myEmployeeId.Value) return Forbid();
            employeeId = myEmployeeId;
        }

        var q = _db.Claims.Include(c => c.Items).AsQueryable();
        if (employeeId.HasValue) q = q.Where(c => c.EmployeeId == employeeId.Value);
        if (status.HasValue) q = q.Where(c => c.Status == status.Value);
        return Ok(await q.OrderByDescending(c => c.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var c = await _db.Claims.Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateClaimRequest request)
    {
        var claim = new ExpenseClaim
        {
            EmployeeId = request.EmployeeId,
            Title = request.Title,
            Currency = request.Currency
        };

        foreach (var item in request.Items)
        {
            if (item.Amount <= 0) return BadRequest("Kalem tutari sifirdan buyuk olmali");
            claim.Items.Add(new ExpenseItem
            {
                Category = item.Category,
                Amount = item.Amount,
                ExpenseDate = item.ExpenseDate,
                Description = item.Description,
                ReceiptStorageKey = item.ReceiptStorageKey
            });
        }

        claim.TotalAmount = claim.Items.Sum(i => i.Amount);
        _db.Claims.Add(claim);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = claim.Id }, claim);
    }

    [HttpPost("{id}/submit")]
    public async Task<IActionResult> Submit(Guid id, [FromBody] SubmitClaimRequest request, CancellationToken ct)
    {
        var claim = await _db.Claims.Include(c => c.Items).FirstOrDefaultAsync(c => c.Id == id);
        if (claim is null) return NotFound();
        if (claim.Status != ClaimStatus.Draft) return BadRequest("Yalnizca taslak beyan gonderilebilir");
        if (claim.Items.Count == 0) return BadRequest("Beyanda en az bir kalem olmali");

        claim.Status = ClaimStatus.Submitted;
        claim.SubmittedAt = DateTimeOffset.UtcNow;

        // Frontend bir WorkflowRequestId verdiyse onu kullan; vermediyse
        // (bugune kadar hep boyle oldu) departman basina otomatik bir onay
        // workflow'u ac - bu olmadan "Onay kutusu" sayfasi bu beyani hicbir
        // zaman gostermiyordu.
        claim.WorkflowRequestId = request.WorkflowRequestId
            ?? await _approvals.StartExpenseApprovalAsync(claim.EmployeeId, claim.Title, ct);

        await _db.SaveChangesAsync();
        return Ok(claim);
    }

    [HttpPost("{id}/resolve")]
    [Authorize(Policy = "RequireExpenseManage")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveClaimRequest request, CancellationToken ct)
    {
        var claim = await _db.Claims.FirstOrDefaultAsync(c => c.Id == id);
        if (claim is null) return NotFound();
        if (claim.Status != ClaimStatus.Submitted)
            return BadRequest("Yalnızca onay bekleyen beyan sonuçlandırılabilir");

        // GUVENLIK: bu uc, workflow-service'teki asil onay akisi basarisiz
        // olursa diye birakilan elle-sonuclandirma yolu - ama
        // RequireManagerOrAbove tek basina "sen bu beyanin sahibi misin"
        // sorusunu cevaplamiyordu. En azindan en bariz acigi (kendi
        // beyanini kendi onaylama/reddetme) kapatiyoruz.
        var myEmployeeId = await _approvals.FindMyEmployeeIdAsync(ct);
        if (myEmployeeId is null || myEmployeeId.Value == claim.EmployeeId)
            return Forbid();

        claim.Status = request.Approved ? ClaimStatus.Approved : ClaimStatus.Rejected;
        await _db.SaveChangesAsync();
        return Ok(claim);
    }

    [HttpPost("{id}/mark-paid")]
    [Authorize(Policy = "RequireExpenseMarkPaid")]
    public async Task<IActionResult> MarkPaid(Guid id)
    {
        var claim = await _db.Claims.FirstOrDefaultAsync(c => c.Id == id);
        if (claim is null) return NotFound();
        if (claim.Status != ClaimStatus.Approved)
            return BadRequest("Yalnızca onaylanmış beyan ödenmiş işaretlenebilir");

        claim.Status = ClaimStatus.Paid;
        claim.PaidAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(claim);
    }
}

public record ExpenseItemInput(
    ExpenseCategory Category, decimal Amount, DateOnly ExpenseDate,
    string? Description, string? ReceiptStorageKey);
public record CreateClaimRequest(
    Guid EmployeeId, string Title, string Currency, List<ExpenseItemInput> Items);
public record SubmitClaimRequest(Guid? WorkflowRequestId);
public record ResolveClaimRequest(bool Approved);
