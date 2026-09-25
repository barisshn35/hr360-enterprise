using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PerformanceService.Data;
using PerformanceService.Models;
using PerformanceService.Services;

namespace PerformanceService.Controllers;

[ApiController]
[Route("api/reviews")]
[Authorize]
public class ReviewsController : ControllerBase
{
    private readonly PerformanceDbContext _db;
    private readonly ScoreCalculator _calculator;
    private readonly SnapshotService _snapshots;
    private readonly DirectoryClient _directory;

    public ReviewsController(
        PerformanceDbContext db, ScoreCalculator calculator,
        SnapshotService snapshots, DirectoryClient directory)
    {
        _db = db;
        _calculator = calculator;
        _snapshots = snapshots;
        _directory = directory;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId, [FromQuery] Guid? cycleId)
    {
        var q = _db.Reviews.Include(r => r.Scores).AsQueryable();
        if (employeeId.HasValue) q = q.Where(r => r.EmployeeId == employeeId.Value);
        if (cycleId.HasValue) q = q.Where(r => r.CycleId == cycleId.Value);
        return Ok(await q.OrderByDescending(r => r.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var r = await _db.Reviews.Include(x => x.Scores).FirstOrDefaultAsync(x => x.Id == id);
        return r is null ? NotFound() : Ok(r);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateReviewRequest request)
    {
        var cycle = await _db.Cycles.FirstOrDefaultAsync(c => c.Id == request.CycleId);
        if (cycle is null) return BadRequest(new { message = "Değerlendirme dönemi bulunamadı" });
        if (cycle.Status == CycleStatus.Closed)
            return BadRequest(new { message = "Kapalı döneme değerlendirme eklenemez" });

        // Ayni degerlendirici ayni kisiyi ayni donemde bir kez degerlendirir.
        var duplicate = await _db.Reviews.AnyAsync(r =>
            r.CycleId == request.CycleId &&
            r.EmployeeId == request.EmployeeId &&
            r.ReviewerEmployeeId == request.ReviewerEmployeeId &&
            r.Type == request.Type);

        if (duplicate)
            return Conflict(new { message = "Bu değerlendirme zaten oluşturulmuş" });

        var review = new Review
        {
            CycleId = request.CycleId,
            EmployeeId = request.EmployeeId,
            ReviewerEmployeeId = request.ReviewerEmployeeId,
            Type = request.Type,
        };

        _db.Reviews.Add(review);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = review.Id }, review);
    }

    /// <summary>
    /// Degerlendirmeyi metrik puanlariyla gonderir.
    /// Zorunlu metriklerin hepsi puanlanmis olmali.
    /// </summary>
    /// <summary>
    /// Degerlendirmeyi TASLAK olarak kaydeder - gondermez.
    ///
    /// Onceki surumde taslak yalnizca tarayicida (localStorage) tutuluyordu;
    /// cihaz degisince ya da tarayici temizlenince kayboluyordu. Bu uc
    /// sunucu tarafinda kismi kayit sagliyor.
    ///
    /// Submit'ten farki: zorunlu metrik kontrolu YAPILMAZ, SubmittedAt
    /// atanmaz, degerlendirme kilitlenmez. Ayni kullanici istedigi kadar
    /// tekrar taslak kaydedebilir.
    /// </summary>
    [HttpPut("{id}/draft")]
    public async Task<IActionResult> SaveDraft(Guid id, [FromBody] SubmitReviewRequest request)
    {
        var review = await _db.Reviews.Include(r => r.Scores).FirstOrDefaultAsync(r => r.Id == id);
        if (review is null) return NotFound();
        if (review.SubmittedAt is not null)
            return BadRequest(new { message = "Gönderilmiş değerlendirme taslak olarak düzenlenemez" });

        var metrics = await _db.Metrics.ToDictionaryAsync(m => m.Id);

        // Taslakta deger araligi yine de kontrol edilir - gecersiz puan
        // sessizce kaydedilmesin.
        foreach (var s in request.Scores)
        {
            if (!metrics.TryGetValue(s.MetricId, out var metric))
                return BadRequest(new { message = $"Bilinmeyen metrik: {s.MetricId}" });

            var (min, max) = metric.Range;
            if (s.Value < min || s.Value > max)
                return BadRequest(new
                {
                    message = $"'{metric.Name}' icin puan {min}-{max} arasinda olmali",
                });
        }

        _db.ReviewScores.RemoveRange(review.Scores);
        foreach (var s in request.Scores)
        {
            _db.ReviewScores.Add(new ReviewScore
            {
                ReviewId = review.Id,
                MetricId = s.MetricId,
                Value = s.Value,
                Comment = s.Comment,
            });
        }

        review.Strengths = request.Strengths;
        review.Improvements = request.Improvements;
        review.Comments = request.Comments;

        await _db.SaveChangesAsync();
        return Ok(new { review.Id, saved = true, isDraft = true });
    }

    [HttpPost("{id}/submit")]
    public async Task<IActionResult> Submit(Guid id, [FromBody] SubmitReviewRequest request)
    {
        var review = await _db.Reviews.Include(r => r.Scores).FirstOrDefaultAsync(r => r.Id == id);
        if (review is null) return NotFound();
        if (review.SubmittedAt is not null)
            return BadRequest(new { message = "Değerlendirme zaten gönderilmiş" });

        // Kapali doneme gonderim reddedilir. Onceki surumde bu kontrol
        // yoktu; degerlendirme, donem kapandiktan SONRA bile gonderilebiliyordu.
        // Resmi sonuc kapanista sabitlendigi icin (CycleClosed kaynakli
        // snapshot) gec gonderim puani degistirmiyordu ama Review kaydi
        // olusuyordu - kafa karistirici bir yarim durum. Artik acikca
        // reddediliyor.
        var cycle = await _db.Cycles.FirstOrDefaultAsync(c => c.Id == review.CycleId);
        if (cycle?.Status == CycleStatus.Closed)
            return BadRequest(new
            {
                message = "Bu dönem kapatılmış, yeni değerlendirme gönderilemez.",
            });

        var allMetrics = await _db.Metrics.Where(m => m.IsActive).ToListAsync();
        var byId = allMetrics.ToDictionary(m => m.Id);

        // Zorunlu metrik kapsami CALISANIN DEPARTMANINA gore daraltilir:
        // departmana ozel bir metrik (DepartmentId dolu) yalnizca o
        // departmandaki calisanlar icin zorunlu sayilir. Once bu kontrol
        // yoktu - baska departmanin metrigi herkese zorunlu gorunuyordu.
        Guid? employeeDept = null;
        var teams = await _directory.GetTeamsForEmployeeAsync(review.EmployeeId, HttpContext.RequestAborted);
        if (teams.Count > 0) employeeDept = teams[0].DepartmentId;

        var metrics = allMetrics
            .Where(m => m.DepartmentId == null || m.DepartmentId == employeeDept)
            .ToList();

        // Zorunlu metrik kontrolu
        var scored = request.Scores.Select(s => s.MetricId).ToHashSet();
        var missing = metrics.Where(m => m.IsRequired && !scored.Contains(m.Id)).ToList();
        if (missing.Count > 0)
            return BadRequest(new
            {
                message = "Zorunlu metrikler puanlanmamış",
                missing = missing.Select(m => new { m.Id, m.Code, m.Name }),
            });

        // Deger araligi kontrolu - her metrigin kendi olcegine gore
        foreach (var s in request.Scores)
        {
            if (!byId.TryGetValue(s.MetricId, out var metric))
                return BadRequest(new { message = $"Bilinmeyen metrik: {s.MetricId}" });

            var (min, max) = metric.Range;
            if (s.Value < min || s.Value > max)
                return BadRequest(new
                {
                    message = $"'{metric.Name}' icin puan {min}-{max} arasinda olmali " +
                              $"(gonderilen: {s.Value})",
                });
        }

        _db.ReviewScores.RemoveRange(review.Scores);
        foreach (var s in request.Scores)
        {
            _db.ReviewScores.Add(new ReviewScore
            {
                ReviewId = review.Id,
                MetricId = s.MetricId,
                Value = s.Value,
                Comment = s.Comment,
            });
        }

        review.Strengths = request.Strengths;
        review.Improvements = request.Improvements;
        review.Comments = request.Comments;
        review.SubmittedAt = DateTimeOffset.UtcNow;

        await _db.SaveChangesAsync();

        // Puani yeniden hesaplayip zaman damgali kaydet. Trend grafikleri
        // bu noktalar uzerinden cizilir; olmazsa elimizde donem basina
        // tek bir puan kalir ve haftalik/aylik gorunum uretilemez.
        // Basarisiz olursa degerlendirme yine de gecerli - anlik goruntu
        // turetilmis veri, sonradan yeniden uretilebilir.
        try
        {
            await _snapshots.CaptureAsync(
                review.EmployeeId, review.CycleId, SnapshotSource.ReviewSubmitted);
        }
        catch (Exception)
        {
            // Sessizce gec - degerlendirmenin kendisi kaydedildi.
        }

        return Ok(review);
    }

    /// <summary>
    /// Bir calisanin bir donemdeki hesaplanmis puani ve TAM DOKUMU.
    /// Puanin nasil olustugu (metrik -> kategori -> nihai) acikca doner;
    /// kapali kutu puan performans degerlendirmesinde guven kirar.
    /// </summary>
    [HttpGet("score")]
    public async Task<IActionResult> GetScore(
        [FromQuery] Guid employeeId, [FromQuery] Guid cycleId)
    {
        var config = await ActiveConfigAsync();
        var metrics = await _db.Metrics.ToListAsync();

        var reviews = await _db.Reviews
            .Where(r => r.EmployeeId == employeeId && r.CycleId == cycleId)
            .ToListAsync();

        var reviewIds = reviews.Select(r => r.Id).ToList();
        var scores = await _db.ReviewScores
            .Where(s => reviewIds.Contains(s.ReviewId)).ToListAsync();

        var goals = await _db.Goals
            .Where(g => g.EmployeeId == employeeId && g.CycleId == cycleId).ToListAsync();

        var result = _calculator.Calculate(config, metrics, reviews, scores, goals);

        return Ok(new
        {
            employeeId,
            cycleId,
            score = result.FinalScore,
            goalScore = result.GoalScore,
            metricScore = result.MetricScore,
            isProvisional = result.IsProvisional,
            provisionalReason = result.ProvisionalReason,
            reviewCount = result.ReviewCount,
            configVersion = config.Version,
            // Ayarin o anki dagilimi - istemci sonradan ayar degisse bile
            // bu puanin hangi yuzdelerle hesaplandigini gormeli. configVersion
            // uzerinden gecmise gidip bulmak yerine dogrudan veriyoruz.
            goalWeightPercent = config.GoalWeightPercent,
            metricWeightPercent = config.MetricWeightPercent,
            breakdown = new
            {
                categories = result.Categories.Select(c => new
                {
                    category = c.Category.ToString(),
                    score = c.Score,
                    weight = c.Weight,
                    metrics = c.Metrics.Select(m => new
                    {
                        m.MetricId, m.Code, m.Name, m.NormalizedScore, m.Weight, m.ReviewCount,
                    }),
                }),
                goals = result.Goals.Select(g => new
                {
                    g.GoalId, g.Title, g.Achievement, g.Weight, status = g.Status.ToString(),
                }),
            },
        });
    }

    private async Task<ScoringConfig> ActiveConfigAsync()
    {
        var cfg = await _db.ScoringConfigs
            .Where(c => c.IsActive).OrderByDescending(c => c.Version).FirstOrDefaultAsync();

        if (cfg is not null) return cfg;

        cfg = new ScoringConfig();
        _db.ScoringConfigs.Add(cfg);
        await _db.SaveChangesAsync();
        return cfg;
    }
}

public record MetricScoreInput(Guid MetricId, decimal Value, string? Comment);

public record CreateReviewRequest(
    Guid CycleId, Guid EmployeeId, Guid ReviewerEmployeeId, ReviewType Type);

public record SubmitReviewRequest(
    List<MetricScoreInput> Scores, string? Strengths, string? Improvements, string? Comments);
