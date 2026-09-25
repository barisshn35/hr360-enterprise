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
    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin");

    /// <summary>Tum beyanlari okuyabilen roller (GetAll'daki mevcut kuralla ayni).</summary>
    private bool CanReadAll => IsHr || User.IsInRole("manager") || User.IsInRole("accounting");

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
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var c = await _db.Claims.Include(x => x.Items).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (c is null) return NotFound();
        // GUVENLIK: Onceden herhangi bir calisan, kimligini bildigi her beyani
        // okuyabiliyordu (liste ucundaki sahiplik kurali burada yoktu).
        if (!CanReadAll)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != c.EmployeeId) return NotFound();
        }
        return Ok(c);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateClaimRequest request, CancellationToken ct)
    {
        // GUVENLIK: EmployeeId istek govdesinden geliyordu - herkes baskasi adina
        // beyan acabiliyordu. IK/muhasebe disindakiler yalnizca kendi adina.
        if (!IsHr && !User.IsInRole("accounting"))
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            if (request.EmployeeId != me.Value)
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "Yalnızca kendi adınıza masraf beyanı oluşturabilirsiniz" });
        }
        if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 200)
            return BadRequest("Başlık zorunlu ve en fazla 200 karakter olabilir");
        var currency = (request.Currency ?? "").Trim().ToUpperInvariant();
        if (!System.Text.RegularExpressions.Regex.IsMatch(currency, "^[A-Z]{3}$"))
            return BadRequest("Para birimi 3 harfli ISO kodu olmalı (örn. TRY)");
        if (request.Items is null || request.Items.Count == 0 || request.Items.Count > 50)
            return BadRequest("Beyanda 1-50 arası kalem olmalı");
        var latestAllowed = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1));
        if (request.Items.Any(i => i.ExpenseDate > latestAllowed))
            return BadRequest("Harcama tarihi gelecekte olamaz");
        if (request.Items.Any(i => i.Amount > 1_000_000m))
            return BadRequest("Kalem tutarı en fazla 1.000.000 olabilir");

        var claim = new ExpenseClaim
        {
            EmployeeId = request.EmployeeId,
            Title = request.Title.Trim(),
            Currency = currency
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

        // GUVENLIK: Sahiplik kontrolu yoktu - herkes baskasinin taslagini gonderebiliyordu.
        if (!IsHr)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != claim.EmployeeId) return NotFound();
        }

        claim.Status = ClaimStatus.Submitted;
        claim.SubmittedAt = DateTimeOffset.UtcNow;

        // Frontend bir WorkflowRequestId verdiyse onu kullan; vermediyse
        // (bugune kadar hep boyle oldu) departman basina otomatik bir onay
        // workflow'u ac - bu olmadan "Onay kutusu" sayfasi bu beyani hicbir
        // zaman gostermiyordu.
        // GUVENLIK: Istemcinin verdigi WorkflowRequestId ARTIK KULLANILMIYOR. Onceden
        // bir yonetici kendi actigi sahte bir akisi (onayci = kendisi) kendi beyanina
        // baglayip onaylayarak KENDI beyanini onaylatabiliyordu (canli dogrulandi).
        // Onay akisini yalnizca sunucu, departman basina yonlendirerek baslatir.
        claim.WorkflowRequestId =
            await _approvals.StartExpenseApprovalAsync(claim.EmployeeId, claim.Title, ct);

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

        // GUVENLIK: Onay akisi olan bir beyan bu uctan sonuclandirilamaz - onceden
        // herhangi bir yonetici, departman basini atlayip tenant'taki her beyani
        // (akis Pending kalirken) buradan onaylayabiliyordu. Bu uc yalnizca akis
        // baslatilamamis (orn. departman basi atanmamis) beyanlar icin.
        if (claim.WorkflowRequestId is not null)
            return Conflict(new { message = "Bu beyan onay akışı üzerinden sonuçlandırılmalı" });

        claim.Status = request.Approved ? ClaimStatus.Approved : ClaimStatus.Rejected;
        if (request.Approved) claim.ApprovedByEmployeeId = myEmployeeId.Value;
        await _db.SaveChangesAsync();
        return Ok(claim);
    }

    [HttpPost("{id}/mark-paid")]
    [Authorize(Policy = "RequireExpenseMarkPaid")]
    public async Task<IActionResult> MarkPaid(Guid id, CancellationToken ct)
    {
        var claim = await _db.Claims.FirstOrDefaultAsync(c => c.Id == id, ct);
        if (claim is null) return NotFound();
        if (claim.Status != ClaimStatus.Approved)
            return BadRequest("Yalnızca onaylanmış beyan ödenmiş işaretlenebilir");

        // GUVENLIK / gorev ayriligi: beyan sahibi ya da onu onaylayan kisi odemeyi
        // isaretleyemez (onceden hr-admin tek basina tum dongunu kapatabiliyordu).
        // Kimligi olmayan platform hesaplari da bu kontrolu atlayamaz.
        var me = await _approvals.FindMyEmployeeIdAsync(ct);
        if (me is null)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "Ödeme işaretlemek için çalışan kaydına bağlı bir hesap gerekli" });
        if (me.Value == claim.EmployeeId || me.Value == claim.ApprovedByEmployeeId)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "Kendi beyanınızı ya da onayladığınız beyanı ödendi işaretleyemezsiniz" });

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
