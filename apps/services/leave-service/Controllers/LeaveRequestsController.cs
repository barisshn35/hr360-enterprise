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
    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin");
    private bool IsManagerOrAbove => IsHr || User.IsInRole("manager");

    /// <summary>
    /// Iki tarih arasindaki is gunu (Pzt-Cum) sayisi. Onceden gun sayisi
    /// istemciden geliyordu: 10 gunluk izin "days: 0.5" ile gonderilip bakiyeden
    /// yarim gun dusuluyordu (canli dogrulandi). Resmi tatil takvimi bu serviste
    /// yok; yalnizca hafta sonlari dislanir.
    /// </summary>
    private static int WorkingDays(DateOnly start, DateOnly end)
    {
        var count = 0;
        for (var d = start; d <= end; d = d.AddDays(1))
            if (d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) count++;
        return count;
    }

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

        if (request.EndDate < request.StartDate)
            return BadRequest("Bitis tarihi baslangictan once olamaz");
        if (request.EndDate.DayNumber - request.StartDate.DayNumber > 365)
            return BadRequest("Tek bir izin talebi en fazla 1 yıl sürebilir");
        if (request.StartDate.Year != request.EndDate.Year)
            return BadRequest("Yıl sonunu aşan izni iki ayrı talep olarak girin (bakiyeler yıllıktır)");
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        if (request.StartDate < today.AddDays(-90))
            return BadRequest("90 günden daha eski bir tarih için izin talebi açılamaz");
        if (request.Reason is { Length: > 1000 })
            return BadRequest("Gerekçe en fazla 1000 karakter olabilir");

        var workingDays = WorkingDays(request.StartDate, request.EndDate);
        if (workingDays == 0)
            return BadRequest("Seçilen aralıkta iş günü yok");
        // Yarim gun: yalnizca tek gunluk taleplerde istemcinin 0.5 bildirmesine izin var.
        var days = request.StartDate == request.EndDate && request.Days == 0.5m
            ? 0.5m
            : workingDays;

        // Ayni calisanin bekleyen/onayli bir izniyle cakisan talep reddedilir.
        var overlaps = await _db.LeaveRequests.AnyAsync(r =>
            r.EmployeeId == request.EmployeeId &&
            (r.Status == LeaveRequestStatus.Submitted || r.Status == LeaveRequestStatus.Approved) &&
            r.StartDate <= request.EndDate && r.EndDate >= request.StartDate, ct);
        if (overlaps)
            return Conflict(new { message = "Bu tarihlerle çakışan bekleyen ya da onaylı bir izniniz var" });

        var balance = await _db.LeaveBalances.FirstOrDefaultAsync(b =>
            b.EmployeeId == request.EmployeeId &&
            b.Year == request.StartDate.Year &&
            b.Type == request.Type);

        if (balance is not null && balance.RemainingDays < days)
            return BadRequest($"Yetersiz bakiye. Kalan: {balance.RemainingDays} gun");
        // Yillik izin bakiye tanimi olmadan acilamaz (onceden bakiye satiri yoksa kontrol
        // tamamen atlaniyor, sinirsiz yillik izin alinabiliyordu). Diger turler
        // (hastalik, ucretsiz vb.) bakiyesiz olabilir.
        if (balance is null && request.Type == LeaveType.Annual)
            return BadRequest($"{request.StartDate.Year} yılı için yıllık izin bakiyeniz tanımlı değil. İK ile iletişime geçin.");

        var leave = new LeaveRequest
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Days = days,
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
                request.Approved, DateTimeOffset.UtcNow)),
        });

        await _db.SaveChangesAsync();
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
        await _db.SaveChangesAsync();
        return Ok(leave);
    }
}

public record CreateLeaveRequest(
    Guid EmployeeId, LeaveType Type, DateOnly StartDate, DateOnly EndDate,
    decimal Days, string? Reason, Guid? WorkflowRequestId);

public record ResolveLeaveRequest(bool Approved);
