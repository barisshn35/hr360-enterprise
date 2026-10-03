using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Models;
using LeaveService.Services;
using LeaveService.Messaging;
using System.Text.Json;

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

    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin");
    private bool IsManagerOrAbove => IsHr || User.IsInRole("manager");

    /// <summary>
    /// Iki tarih arasindaki is gunu sayisi: hafta sonlari ve sirketin resmi tatil
    /// takvimindeki gunler (PublicHolidays) dislanir. Onceden gun sayisi istemciden
    /// geliyordu: 10 gunluk izin "days: 0.5" ile gonderilip bakiyeden yarim gun
    /// dusuluyordu (canli dogrulandi).
    /// </summary>
    private async Task<int> WorkingDaysAsync(DateOnly start, DateOnly end, CancellationToken ct)
    {
        var holidays = (await _db.PublicHolidays
            .Where(h => h.Date >= start && h.Date <= end)
            .Select(h => h.Date).ToListAsync(ct)).ToHashSet();
        var count = 0;
        for (var d = start; d <= end; d = d.AddDays(1))
            if (d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday) && !holidays.Contains(d)) count++;
        return count;
    }

    /// <summary>
    /// Izin taleplerini listeler.
    ///
    /// GUVENLIK: Onceden employeeId filtresi serbestti; bir calisan baskasinin
    /// taleplerini, filtresiz cagirarak da tum sirketinkileri gorebiliyordu. Simdi:
    ///   - Yonetici ve ustu: istedigi employeeId'yi (ya da hicbirini) sorgulayabilir.
    ///   - Calisan: yalnizca kendi taleplerini gorur; employeeId vermezse kendisine
    ///     sabitlenir, baska birininkini verirse 403 doner.
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
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var r = await _db.LeaveRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return NotFound();
        // GUVENLIK: Onceden kimligi bilinen her izin talebi (gerekce metni dahil)
        // herkese aciktu. Liste ucundaki kuralla ayni: yonetici+ ya da sahibi.
        if (!IsManagerOrAbove)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != r.EmployeeId) return NotFound();
        }
        return Ok(r);
    }

    /// <summary>Izin talebi olusturur, bakiyeden 'beklemede' olarak duser ve
    /// calisanin departman basina onay icin bir workflow acar.</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateLeaveRequest request, CancellationToken ct)
    {
        // GUVENLIK: EmployeeId istek govdesinden geliyordu - herkes baskasi adina izin
        // talebi acabiliyor, o kisinin bakiyesini "beklemede" olarak kilitleyebiliyordu
        // (canli dogrulandi). IK disindakiler yalnizca kendi adina talep acar.
        if (!IsHr)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null) return Forbid();
            if (request.EmployeeId != me.Value)
                return StatusCode(StatusCodes.Status403Forbidden,
                    new { message = "Yalnızca kendi adınıza izin talebi oluşturabilirsiniz" });
        }
        var (error, leave) = await CreateCoreAsync(request, internalCall: false, ct);
        return error ?? CreatedAtAction(nameof(GetById), new { id = leave!.Id }, leave);
    }

    /// <summary>
    /// Sohbet botundan (Slack/Teams) açılan izin talebi. Web ucuyla aynı kurallar uygulanır;
    /// çalışan, botun doğrulanmış sohbet hesabından gelir. Onay akışı da servisler arası
    /// açılır. Gateway /api/*/internal/ yollarını dışarıya kapatır; anahtar yoksa uç kapalıdır.
    /// </summary>
    [HttpPost("/api/internal/leave-requests")]
    [AllowAnonymous]
    public async Task<IActionResult> CreateInternal([FromBody] InternalCreateLeaveRequest request,
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
        var (error, leave) = await CreateCoreAsync(new CreateLeaveRequest(request.EmployeeId, request.Type, request.StartDate, request.EndDate,
            request.Days, request.Reason, null), internalCall: true, ct);
        return error ?? Ok(new { leave!.Id, leave.Days, leave.WorkflowRequestId, status = leave.Status.ToString() });
    }

    private async Task<(IActionResult? Error, LeaveRequest? Leave)> CreateCoreAsync(CreateLeaveRequest request, bool internalCall, CancellationToken ct)
    {
        IActionResult Bad(string m) => BadRequest(new { message = m });
        if (request.EndDate < request.StartDate)
            return (Bad("Bitiş tarihi başlangıçtan önce olamaz"), null);
        if (request.EndDate.DayNumber - request.StartDate.DayNumber > 365)
            return (Bad("Tek bir izin talebi en fazla 1 yıl sürebilir"), null);
        if (request.StartDate.Year != request.EndDate.Year)
            return (Bad("Yıl sonunu aşan izni iki ayrı talep olarak girin (bakiyeler yıllıktır)"), null);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (request.StartDate < today.AddDays(-90))
            return (Bad("90 günden daha eski bir tarih için izin talebi açılamaz"), null);
        if (request.Reason is { Length: > 1000 })
            return (Bad("Gerekçe en fazla 1000 karakter olabilir"), null);

        var workingDays = await WorkingDaysAsync(request.StartDate, request.EndDate, ct);
        if (workingDays == 0)
            return (Bad("Seçilen aralıkta iş günü yok"), null);
        // Yarim gun: yalnizca tek gunluk taleplerde istemcinin 0.5 bildirmesine izin var.
        // Saatlik izin (G8): yalnizca tek gun; gun = saat / gunluk calisma saati (LEAVE_DAY_HOURS).
        decimal? hours = null;
        if (request.Hours is { } h)
        {
            if (request.StartDate != request.EndDate)
                return (Bad("Saatlik izin yalnızca tek gün için girilebilir"), null);
            if (h <= 0 || h >= Services.LeaveEntitlement.DayHours || h * 2 != Math.Floor(h * 2))
                return (Bad($"Saatlik izin 0,5 saatlik adımlarla ve {Services.LeaveEntitlement.DayHours:0.#} saatten az olmalı"), null);
            hours = h;
        }
        var days = hours is { } hh
            ? Services.LeaveEntitlement.HoursToDays(hh)
            : request.StartDate == request.EndDate && request.Days == 0.5m
                ? 0.5m
                : workingDays;

        // Ayni calisanin bekleyen/onayli bir izniyle cakisan talep reddedilir.
        var overlaps = await _db.LeaveRequests.AnyAsync(r =>
            r.EmployeeId == request.EmployeeId &&
            (r.Status == LeaveRequestStatus.Submitted || r.Status == LeaveRequestStatus.Approved) &&
            r.StartDate <= request.EndDate && r.EndDate >= request.StartDate, ct);
        if (overlaps)
            return (Conflict(new { message = "Bu tarihlerle çakışan bekleyen ya da onaylı bir izniniz var" }), null);

        var balance = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == request.EmployeeId &&
            b.Year == request.StartDate.Year &&
            b.Type == request.Type);

        if (balance is not null && balance.RemainingDays < days)
            return (Bad($"Yetersiz bakiye. Kalan: {balance.RemainingDays} gün"), null);
        // Yillik izin bakiye tanimi olmadan acilamaz (onceden bakiye satiri yoksa kontrol
        // tamamen atlaniyor, sinirsiz yillik izin alinabiliyordu). Diger turler
        // (hastalik, ucretsiz vb.) bakiyesiz olabilir.
        if (balance is null && request.Type == LeaveType.Annual)
            return (Bad($"{request.StartDate.Year} yılı için yıllık izin bakiyeniz tanımlı değil. İK ile iletişime geçin."), null);

        var leave = new LeaveRequest
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Days = days,
            Hours = hours,
            Reason = request.Reason,
            Status = LeaveRequestStatus.Submitted,
            // GUVENLIK: istemcinin WorkflowRequestId'si ARTIK KULLANILMAZ - onay akisini
            // yalnizca sunucu baslatir (aksi halde kendi actigi sahte bir akisi kendi
            // talebine baglayip onaylatabilirdi).
            WorkflowRequestId = null
        };

        if (balance is not null)
        {
            balance.PendingDays += days;
            balance.UpdatedAt = DateTimeOffset.UtcNow;
        }

        _db.LeaveRequests.Add(leave);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            return (Conflict(new { message = "Bakiyeniz aynı anda başka bir işlemle güncellendi; lütfen tekrar deneyin." }), null);
        }

        // Departman basina onay workflow'u ac - bulunamazsa (bas atanmamis,
        // cross-service cagri hatasi) talep yine de Submitted olarak kalir
        // ve mevcut /resolve ucuyla elle sonuclandirilabilir.
        var subject = hours is { } sh
            ? $"{sh:0.#} saatlik {leave.Type} talebi ({leave.StartDate:dd.MM.yyyy})"
            : $"{days} günlük {leave.Type} talebi ({leave.StartDate:dd.MM.yyyy} - {leave.EndDate:dd.MM.yyyy})";
        // Onay mesajlarında (web, e-posta, sohbet) tarih ve gün sayısı gösterilebilsin diye.
        var payload = System.Text.Json.JsonSerializer.Serialize(new
        {
            leaveRequestId = leave.Id, type = leave.Type.ToString(), startDate = leave.StartDate.ToString("yyyy-MM-dd"),
            endDate = leave.EndDate.ToString("yyyy-MM-dd"), days = leave.Days, hours = leave.Hours,
        });
        var workflowId = internalCall
            ? await _approvals.StartLeaveApprovalInternalAsync(_db, leave.EmployeeId, subject, ct, payload)
            : await _approvals.StartLeaveApprovalAsync(leave.EmployeeId, subject, ct, payload);
        if (workflowId is not null)
        {
            leave.WorkflowRequestId = workflowId;
            await _db.SaveChangesAsync();
        }

        return (null, leave);
    }

    /// <summary>
    /// Onay akisi OLMAYAN bir talebi (orn. departman basinin kendi izni, basi atanmamis
    /// departman) IK'nin elle sonuclandirmasi ve bakiyeyi kesinlestirmesi. Akisi olan
    /// talepler workflow-service'teki karar uzerinden sonuclanir (409).
    /// </summary>
    [HttpPost("{id}/resolve")]
    [Authorize(Policy = "RequireHrAdmin")]
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

        // GUVENLIK: Onceden herhangi bir yonetici, onay akisi hala bekleyen herhangi
        // bir talebi (departman basini atlayarak) buradan sonuclandirabiliyordu. Bu uc
        // artik yalnizca akisi OLMAYAN talepler (orn. departman basinin kendi izni,
        // bas atanmamis departman) icin ve yalnizca IK tarafindan kullanilabilir.
        if (!IsHr) return Forbid();
        if (leave.WorkflowRequestId is not null)
            return Conflict(new { message = "Bu talep onay akışı üzerinden sonuçlandırılmalı" });

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

        // NOT: Onceden bu yol hic event yayinlamiyordu - elle onaylanan izin
        // timeshift-service'e ulasmiyor, vardiya planinda hic gorunmuyordu.
        _db.OutboxMessages.Add(new OutboxMessage
        {
            Topic = LeaveTopics.Events,
            EventType = request.Approved ? "leave.approved" : "leave.rejected",
            PartitionKey = leave.EmployeeId.ToString(),
            Payload = JsonSerializer.Serialize(new LeaveDecidedEvent(
                leave.TenantSlug, leave.Id, leave.EmployeeId, leave.StartDate, leave.EndDate,
                request.Approved, DateTimeOffset.UtcNow, leave.Type.ToString(), leave.Days)),
        });

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(new { message = "Bakiye aynı anda güncellendi; lütfen tekrar deneyin." });
        }
        return Ok(leave);
    }

    [HttpPost("{id}/cancel")]
    public async Task<IActionResult> Cancel(Guid id, CancellationToken ct)
    {
        var leave = await _db.LeaveRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (leave is null) return NotFound();
        // GUVENLIK: Sahiplik kontrolu yoktu - herkes baskasinin bekleyen iznini iptal
        // edebiliyordu. Yalnizca talep sahibi ya da IK.
        if (!IsHr)
        {
            var me = await _approvals.FindMyEmployeeIdAsync(ct);
            if (me is null || me.Value != leave.EmployeeId) return NotFound();
        }
        if (leave.Status == LeaveRequestStatus.Cancelled)
            return BadRequest("Talep zaten iptal edilmiş");
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
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateConcurrencyException)
        {
            return Conflict(new { message = "Bakiye aynı anda güncellendi; lütfen tekrar deneyin." });
        }

        // NOT: Onceden iptal edilen iznin onay akisi acik kaliyordu - onayci talebi
        // "Onay kutusu"nda gormeye devam ediyor, onaylasa bile hicbir sey olmuyordu.
        if (leave.WorkflowRequestId is { } wf)
            await _approvals.CancelWorkflowAsync(wf, ct);
        return Ok(leave);
    }
}

public record CreateLeaveRequest(
    Guid EmployeeId, LeaveType Type, DateOnly StartDate, DateOnly EndDate,
    decimal Days, string? Reason, Guid? WorkflowRequestId, decimal? Hours = null);

public record ResolveLeaveRequest(bool Approved);
public record InternalCreateLeaveRequest(string TenantSlug, Guid EmployeeId, LeaveType Type, DateOnly StartDate, DateOnly EndDate,
    decimal Days, string? Reason);
