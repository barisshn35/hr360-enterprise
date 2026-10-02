using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PerformanceService.Data;
using PerformanceService.Models;
using PerformanceService.Security;
using PerformanceService.Services;

namespace PerformanceService.Controllers;

[ApiController]
[Route("api/goals")]
[Authorize]
public class GoalsController : ControllerBase
{
    private readonly PerformanceDbContext _db;
    private readonly DirectoryClient _directory;

    public GoalsController(PerformanceDbContext db, DirectoryClient directory)
    {
        _db = db;
        _directory = directory;
    }

    /// <summary>
    /// Hedefleri listeler.
    ///
    /// GUVENLIK: onceki surumde bu uc herkese acikti - bir calisan
    /// employeeId parametresini degistirerek BASKA HERHANGI BIR calisanin
    /// hedeflerini gorebiliyordu, hatta employeeId hic vermeden TUM
    /// sirketin hedeflerini cekebiliyordu. Artik:
    ///   - Yonetici ve ustu: istedigi employeeId'yi (ya da hicbirini)
    ///     sorgulayabilir.
    ///   - Calisan: yalnizca KENDI employeeId'sini sorgulayabilir; farkli
    ///     bir ID verirse ya da hic vermezse 403 doner.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] Guid? cycleId, CancellationToken ct)
    {
        var isManager = User.IsManagerOrAbove();

        if (!isManager)
        {
            var me = await _directory.FindMeAsync(ct);

            if (me is null)
                return Forbid();

            if (employeeId.HasValue && employeeId.Value != me.Id)
                return Forbid();

            employeeId = me.Id;   // employeeId verilmemisse de kendine sabitlenir
        }

        var q = _db.Goals.AsQueryable();
        if (employeeId.HasValue) q = q.Where(g => g.EmployeeId == employeeId.Value);
        if (cycleId.HasValue) q = q.Where(g => g.CycleId == cycleId.Value);
        return Ok(await q.OrderByDescending(g => g.CreatedAt).ToListAsync());
    }

    /// <summary>
    /// GUVENLIK: Onceden herkes herkese hedef ekleyebiliyor, herhangi bir hedefin
    /// ilerlemesini/durumunu (orn. kendi hedefini "Achieved") degistirebiliyordu -
    /// hedefler nihai puana girdigi icin calisan kendi puanini sisirebiliyordu.
    /// Hedefleri ve ilerlemeyi yonetici+ yonetir (web istemcisi de boyle calisir).
    /// </summary>
    [HttpPost]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Create([FromBody] CreateGoalRequest request)
    {
        var cycle = await _db.Cycles.FirstOrDefaultAsync(c => c.Id == request.CycleId);
        if (cycle is null) return BadRequest("Değerlendirme dönemi bulunamadı");
        if (cycle.Status == CycleStatus.Closed) return BadRequest("Kapalı döneme hedef eklenemez");

        var goal = new Goal
        {
            CycleId = request.CycleId,
            EmployeeId = request.EmployeeId,
            Title = request.Title,
            Description = request.Description,
            Weight = request.Weight,
            TargetValue = request.TargetValue,
            Unit = request.Unit,
            Status = GoalStatus.Active
        };
        _db.Goals.Add(goal);
        await _db.SaveChangesAsync();
        return Created($"/api/goals/{goal.Id}", goal);
    }

    [HttpPost("{id}/progress")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> UpdateProgress(Guid id, [FromBody] UpdateProgressRequest request)
    {
        var goal = await _db.Goals.FirstOrDefaultAsync(g => g.Id == id);
        if (goal is null) return NotFound();
        var cycle = await _db.Cycles.FirstOrDefaultAsync(c => c.Id == goal.CycleId);
        if (cycle?.Status == CycleStatus.Closed)
            return BadRequest(new { message = "Kapanmış dönemin hedefleri güncellenemez" });
        if (request.CurrentValue is < 0)
            return BadRequest(new { message = "Gerçekleşen değer negatif olamaz" });
        if (request.Status.HasValue && !Enum.IsDefined(request.Status.Value))
            return BadRequest(new { message = "Geçerli bir durum seçin" });

        // Yalnizca durum degistiren istekte deger gonderilmez; mevcut deger korunur
        // (onceden eksik alan 0 sayilip gerceklesen deger sifirlaniyordu).
        if (request.CurrentValue.HasValue) goal.CurrentValue = request.CurrentValue.Value;
        if (request.Status.HasValue) goal.Status = request.Status.Value;
        await _db.SaveChangesAsync();
        return Ok(goal);
    }
}

public record CreateGoalRequest(
    Guid CycleId, Guid EmployeeId, string Title, string? Description,
    int Weight, decimal? TargetValue, string? Unit);
public record UpdateProgressRequest(decimal? CurrentValue, GoalStatus? Status);
