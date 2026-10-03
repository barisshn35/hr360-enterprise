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
    private readonly FxService _fx;
    private readonly ExpenseService.Tenancy.ITenantContext _tenant;
    public ExpenseClaimsController(ExpenseDbContext db, ApprovalWorkflowClient approvals, FxService fx, ExpenseService.Tenancy.ITenantContext tenant)
    {
        _db = db;
        _approvals = approvals;
        _fx = fx;
        _tenant = tenant;
    }

    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin");

    /// <summary>
    /// Tum beyanlari okuyabilen roller. Odendi isaretleyen (muhasebe veya "odeme
    /// isaretleme" ek izni olan) kisi, isaretleyecegi beyanlari gorebilmeli.
    /// </summary>
    private bool CanReadAll => IsHr || User.IsInRole("manager") || User.IsInRole("accounting")
        || User.IsInRole("ext-expense-markPaid") || User.IsInRole("ext-expense-manage");

    /// <summary>
    /// Masraf beyanlarini listeler.
    ///
    /// GUVENLIK: Onceden employeeId filtresi serbestti; bir calisan baskasinin
    /// beyanlarini (tutar, kalemler), filtresiz cagirarak da tum sirketinkileri
    /// gorebiliyordu. Simdi:
    ///   - Yonetici, IK, muhasebe ve ilgili ek izinler: istedigi employeeId'yi
    ///     (ya da hicbirini) sorgulayabilir.
    ///   - Calisan: yalnizca kendi beyanlarini gorur; employeeId vermezse kendisine
    ///     sabitlenir, baska birininkini verirse 403 doner.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] ClaimStatus? status, CancellationToken ct)
    {
        if (!CanReadAll)
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
        // beyan acabiliyordu. IK disindakiler (muhasebe dahil) yalnizca kendi adina
        // acabilir; baskasi adina acilan taslagi onaya yalnizca sahibi ya da IK gonderebilir.
        if (!IsHr)
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

        var policy = await _db.Policies.AsNoTracking().FirstOrDefaultAsync(ct);
        foreach (var item in request.Items)
        {
            var amount = item.Amount;
            decimal? rate = null;
            string? origCur = null;
            decimal? km = null;
            // G9: kilometre masrafı km × kiracının km ücreti; yabancı para harcama günündeki TCMB kuruyla TL'ye çevrilir.
            if (item.Category == ExpenseCategory.Mileage)
            {
                if (item.Km is not (> 0 and <= 10000)) return BadRequest("Kilometre 0–10000 arasında olmalı");
                km = item.Km;
                amount = Math.Round(item.Km.Value * (policy?.KmRate ?? new ExpensePolicy().KmRate), 2);
            }
            else if (!string.IsNullOrWhiteSpace(item.OriginalCurrency) && item.OriginalCurrency.ToUpperInvariant() != currency)
            {
                if (currency != "TRY") return BadRequest("Yabancı para kalemi yalnızca TL beyanda kullanılabilir");
                if (item.OriginalAmount is not > 0) return BadRequest("Yabancı para tutarı gerekli");
                origCur = item.OriginalCurrency.Trim().ToUpperInvariant();
                var fx = await _fx.RateAsync(_db, _tenant.TenantSlug, origCur, item.ExpenseDate, ct);
                if (fx is null) return BadRequest(new { message = $"{origCur} için {item.ExpenseDate:dd.MM.yyyy} kuru bulunamadı; İK elle kur girebilir.", code = "fx_unavailable" });
                rate = fx.Value.Rate;
                amount = Math.Round(item.OriginalAmount.Value * rate.Value, 2);
            }
            if (amount <= 0) return BadRequest("Kalem tutari sifirdan buyuk olmali");
            claim.Items.Add(new ExpenseItem
            {
                Category = item.Category,
                Amount = amount,
                ExpenseDate = item.ExpenseDate,
                Description = item.Description,
                ReceiptStorageKey = item.ReceiptStorageKey,
                OriginalCurrency = origCur,
                OriginalAmount = origCur is null ? null : item.OriginalAmount,
                FxRate = rate,
                Km = km,
                TravelRequestId = item.TravelRequestId,
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

        // G9: politika denetimi (kalem/aylık limit, fiş zorunluluğu).
        var policy = await _db.Policies.AsNoTracking().FirstOrDefaultAsync(ct);
        var limits = ExpensePolicies.Limits(policy);
        if (limits.Count > 0)
        {
            var monthStart = new DateOnly(DateTime.UtcNow.Year, DateTime.UtcNow.Month, 1);
            var mtd = await _db.Items.AsNoTracking()
                .Where(i => i.ClaimId != claim.Id && i.ExpenseDate >= monthStart && i.Claim!.EmployeeId == claim.EmployeeId
                    && (i.Claim.Status == ClaimStatus.Submitted || i.Claim.Status == ClaimStatus.Approved || i.Claim.Status == ClaimStatus.Paid))
                .GroupBy(i => i.Category).Select(g => new { g.Key, Sum = g.Sum(i => i.Amount) }).ToDictionaryAsync(x => x.Key, x => x.Sum, ct);
            var violations = ExpensePolicies.Violations(claim.Items, limits, mtd);
            if (violations.Count > 0)
                return BadRequest(new { message = "Masraf politikasına uymayan kalemler var: " + string.Join("; ", violations), code = "policy_violation", violations });
        }

        claim.Status = ClaimStatus.Submitted;
        claim.SubmittedAt = DateTimeOffset.UtcNow;

        // Departman basina otomatik bir onay akisi acilir; bu olmadan "Onay kutusu"
        // sayfasi beyani hic gostermiyordu.
        // GUVENLIK: Istemcinin verdigi WorkflowRequestId KULLANILMAZ (alan yalnizca
        // eski istemcilerle uyumluluk icin kabul edilir). Onceden
        // bir yonetici kendi actigi sahte bir akisi (onayci = kendisi) kendi beyanina
        // baglayip onaylayarak KENDI beyanini onaylatabiliyordu (canli dogrulandi).
        // Onay akisini yalnizca sunucu, departman basina yonlendirerek baslatir.
        claim.WorkflowRequestId =
            await _approvals.StartExpenseApprovalAsync(claim.EmployeeId, claim.Title, ct,
                // Akış tanımındaki tutar koşulları (ör. 10.000 TL üstü finans onayı) için.
                System.Text.Json.JsonSerializer.Serialize(new { expenseClaimId = claim.Id, amount = claim.TotalAmount, currency = claim.Currency }));

        await _db.SaveChangesAsync();
        return Ok(claim);
    }

    [HttpPost("{id}/resolve")]
    [Authorize(Policy = "RequireExpenseManage")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveClaimRequest request, CancellationToken ct)
    {
        var claim = await _db.Claims.Include(c => c.Items).FirstOrDefaultAsync(c => c.Id == id);
        if (claim is null) return NotFound();
        if (claim.Status != ClaimStatus.Submitted)
            return BadRequest("Yalnızca onay bekleyen beyan sonuçlandırılabilir");

        // GUVENLIK: bu uc, workflow-service'teki asil onay akisi basarisiz
        // olursa diye birakilan elle-sonuclandirma yolu - ama politika
        // (RequireExpenseManage) tek basina "sen bu beyanin sahibi misin"
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
        var claim = await _db.Claims.Include(c => c.Items).FirstOrDefaultAsync(c => c.Id == id, ct);
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
    string? Description, string? ReceiptStorageKey,
    string? OriginalCurrency = null, decimal? OriginalAmount = null, decimal? Km = null, Guid? TravelRequestId = null);
public record CreateClaimRequest(
    Guid EmployeeId, string Title, string Currency, List<ExpenseItemInput> Items);
public record SubmitClaimRequest(Guid? WorkflowRequestId);
public record ResolveClaimRequest(bool Approved);
