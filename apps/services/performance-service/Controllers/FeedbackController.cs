using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PerformanceService.Data;
using PerformanceService.Models;

namespace PerformanceService.Controllers;

/// <summary>
/// Calisanlara yazilan geri bildirimler.
///
/// Tasarim tercihi: geri bildirim ANONIM DEGIL. Calisan kimin yazdigini
/// gorur. Anonimlik hesap sorulabilirligi zayiflatir ve kotuye kullanima
/// acik hale getirir. Gizli kalmasi gereken notlar icin
/// visibleToEmployee=false kullanilir; o zaman calisana hic gosterilmez.
/// </summary>
[ApiController]
[Route("api/feedback")]
[Authorize]
public class FeedbackController : ControllerBase
{
    private readonly PerformanceDbContext _db;
    public FeedbackController(PerformanceDbContext db) => _db = db;

    /// <summary>
    /// Bir calisana gelen geri bildirimler.
    /// Calisan kendi kaydini goruyorsa yalnizca gorunur olanlar donduruler.
    /// </summary>
    [HttpGet("received/{employeeId}")]
    public async Task<IActionResult> Received(
        Guid employeeId,
        [FromQuery] bool asManager = false,
        [FromQuery] FeedbackReason? reason = null,
        [FromQuery] DateTimeOffset? since = null)
    {
        var q = _db.Feedback.Where(f => f.ToEmployeeId == employeeId);

        // Yonetici gorunumu degilse gizli notlar filtrelenir.
        if (!asManager || !User.IsInRole("manager") && !User.IsInRole("hr-admin")
                       && !User.IsInRole("tenant-admin") && !User.IsInRole("platform-admin"))
        {
            q = q.Where(f => f.VisibleToEmployee);
        }

        if (reason.HasValue) q = q.Where(f => f.Reason == reason.Value);
        if (since.HasValue) q = q.Where(f => f.CreatedAt >= since.Value);

        var list = await q.OrderByDescending(f => f.CreatedAt).ToListAsync();

        return Ok(list.Select(f => new
        {
            f.Id,
            f.FromEmployeeId,          // kimden geldigi acikca gorunur
            f.ToEmployeeId,
            f.CycleId,
            f.MetricId,
            reason = f.Reason.ToString(),
            f.ReasonDetail,
            sentiment = f.Sentiment.ToString(),
            f.Body,
            f.VisibleToEmployee,
            f.CreatedAt,
            f.ReadAt,
        }));
    }

    /// <summary>Bir kisinin yazdigi geri bildirimler.</summary>
    [HttpGet("sent/{employeeId}")]
    public async Task<IActionResult> Sent(Guid employeeId)
        => Ok(await _db.Feedback
            .Where(f => f.FromEmployeeId == employeeId)
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync());

    [HttpPost]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Create([FromBody] CreateFeedbackRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Body))
            return BadRequest(new { message = "Geri bildirim metni bos olamaz" });

        if (request.FromEmployeeId == request.ToEmployeeId)
            return BadRequest(new { message = "Kisi kendine geri bildirim yazamaz" });

        // Sebep aciklamasi, yapici/olumsuz geri bildirimde zorunlu:
        // "gelistirilmeli" deyip gerekce yazmamak ise yaramaz.
        if (request.Sentiment == FeedbackSentiment.Constructive &&
            string.IsNullOrWhiteSpace(request.ReasonDetail))
        {
            return BadRequest(new
            {
                message = "Yapıcı geri bildirimde gerekçe (reasonDetail) zorunludur",
            });
        }

        var feedback = new Feedback
        {
            FromEmployeeId = request.FromEmployeeId,
            ToEmployeeId = request.ToEmployeeId,
            CycleId = request.CycleId,
            MetricId = request.MetricId,
            Reason = request.Reason,
            ReasonDetail = request.ReasonDetail,
            Sentiment = request.Sentiment,
            Body = request.Body,
            VisibleToEmployee = request.VisibleToEmployee,
        };

        _db.Feedback.Add(feedback);
        await _db.SaveChangesAsync();
        return Created($"/api/feedback/{feedback.Id}", feedback);
    }

    [HttpPost("{id}/mark-read")]
    public async Task<IActionResult> MarkRead(Guid id)
    {
        var f = await _db.Feedback.FirstOrDefaultAsync(x => x.Id == id);
        if (f is null) return NotFound();
        if (!f.VisibleToEmployee) return Forbid();

        f.ReadAt ??= DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(f);
    }

    /// <summary>
    /// Ekip geri bildirim ozeti: hangi sebeple ne kadar geri bildirim
    /// veriliyor, ton dagilimi nasil. Yoneticiye ekibin geri bildirim
    /// kulturu hakkinda fikir verir.
    /// </summary>
    [HttpGet("summary")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Summary(
        [FromQuery] Guid? employeeId,
        [FromQuery] DateTimeOffset? since)
    {
        var q = _db.Feedback.AsQueryable();
        if (employeeId.HasValue) q = q.Where(f => f.ToEmployeeId == employeeId.Value);
        if (since.HasValue) q = q.Where(f => f.CreatedAt >= since.Value);

        var items = await q.ToListAsync();

        return Ok(new
        {
            total = items.Count,
            unread = items.Count(f => f.ReadAt is null && f.VisibleToEmployee),
            bySentiment = items.GroupBy(f => f.Sentiment)
                .Select(g => new { sentiment = g.Key.ToString(), count = g.Count() }),
            byReason = items.GroupBy(f => f.Reason)
                .Select(g => new { reason = g.Key.ToString(), count = g.Count() })
                .OrderByDescending(x => x.count),
        });
    }
}

public record CreateFeedbackRequest(
    Guid FromEmployeeId,
    Guid ToEmployeeId,
    string Body,
    FeedbackReason Reason,
    string? ReasonDetail,
    FeedbackSentiment Sentiment,
    Guid? CycleId,
    Guid? MetricId,
    bool VisibleToEmployee = true);
