using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PerformanceService.Data;
using PerformanceService.Models;
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
        var isManager = User.IsInRole("manager") || User.IsInRole("hr-admin")
            || User.IsInRole("tenant-admin") || User.IsInRole("system-admin")
            || User.IsInRole("platform-admin");

        if (!isManager)
        {
            var email = User.FindFirst("email")?.Value;
            var me = string.IsNullOrWhiteSpace(email)
                ? null : await _directory.FindEmployeeByEmailAsync(email, ct);

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

    [HttpPost]
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
    public async Task<IActionResult> UpdateProgress(Guid id, [FromBody] UpdateProgressRequest request)
    {
        var goal = await _db.Goals.FirstOrDefaultAsync(g => g.Id == id);
        if (goal is null) return NotFound();

        goal.CurrentValue = request.CurrentValue;
        if (request.Status.HasValue) goal.Status = request.Status.Value;
        await _db.SaveChangesAsync();
        return Ok(goal);
    }
}

public record CreateGoalRequest(
    Guid CycleId, Guid EmployeeId, string Title, string? Description,
    int Weight, decimal? TargetValue, string? Unit);
public record UpdateProgressRequest(decimal CurrentValue, GoalStatus? Status);
