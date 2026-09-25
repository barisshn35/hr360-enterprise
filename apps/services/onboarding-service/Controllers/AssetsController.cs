using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OnboardingService.Data;
using OnboardingService.Models;

namespace OnboardingService.Controllers;

[ApiController]
[Route("api/assets")]
[Authorize]
public class AssetsController : ControllerBase
{
    private readonly OnboardingDbContext _db;
    public AssetsController(OnboardingDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] AssetStatus? status, [FromQuery] AssetType? type)
    {
        var q = _db.Assets.AsQueryable();
        if (status.HasValue) q = q.Where(a => a.Status == status.Value);
        if (type.HasValue) q = q.Where(a => a.Type == type.Value);
        return Ok(await q.OrderBy(a => a.AssetTag).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var a = await _db.Assets
            .Include(x => x.Assignments.OrderByDescending(s => s.AssignedOn))
            .FirstOrDefaultAsync(x => x.Id == id);
        return a is null ? NotFound() : Ok(a);
    }

    [HttpPost]
    [Authorize(Policy = "RequireAssetManage")]
    public async Task<IActionResult> Create([FromBody] CreateAssetRequest request)
    {
        if (await _db.Assets.AnyAsync(a => a.AssetTag == request.AssetTag))
            return Conflict("Bu zimmet etiketi zaten kayıtlı");

        var asset = new Asset
        {
            AssetTag = request.AssetTag,
            Type = request.Type,
            Model = request.Model,
            SerialNumber = request.SerialNumber
        };
        _db.Assets.Add(asset);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = asset.Id }, asset);
    }

    [HttpPost("{id}/assign")]
    [Authorize(Policy = "RequireAssetManage")]
    public async Task<IActionResult> Assign(Guid id, [FromBody] AssignAssetRequest request)
    {
        var asset = await _db.Assets.FirstOrDefaultAsync(a => a.Id == id);
        if (asset is null) return NotFound();
        if (asset.Status != AssetStatus.Available)
            return BadRequest($"Zimmet uygun durumda değil (mevcut: {asset.Status})");

        var assignment = new AssetAssignment
        {
            AssetId = id,
            EmployeeId = request.EmployeeId,
            AssignedOn = request.AssignedOn,
            Notes = request.Notes
        };
        asset.Status = AssetStatus.Assigned;

        _db.AssetAssignments.Add(assignment);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id }, assignment);
    }

    [HttpPost("{id}/return")]
    [Authorize(Policy = "RequireAssetManage")]
    public async Task<IActionResult> Return(Guid id, [FromBody] ReturnAssetRequest request)
    {
        var asset = await _db.Assets.FirstOrDefaultAsync(a => a.Id == id);
        if (asset is null) return NotFound();

        var open = await _db.AssetAssignments
            .Where(a => a.AssetId == id && a.ReturnedOn == null)
            .OrderByDescending(a => a.AssignedOn)
            .FirstOrDefaultAsync();
        if (open is null) return BadRequest("Bu zimmetin acik atamasi yok");

        open.ReturnedOn = request.ReturnedOn;
        open.ConditionOnReturn = request.Condition;
        asset.Status = request.MarkAsRetired ? AssetStatus.Retired : AssetStatus.Available;

        await _db.SaveChangesAsync();
        return Ok(open);
    }

    [HttpGet("by-employee/{employeeId}")]
    public async Task<IActionResult> GetByEmployee(Guid employeeId)
    {
        var list = await _db.AssetAssignments
            .Include(a => a.Asset)
            .Where(a => a.EmployeeId == employeeId)
            .OrderByDescending(a => a.AssignedOn)
            .ToListAsync();
        return Ok(list);
    }
}

public record CreateAssetRequest(string AssetTag, AssetType Type, string? Model, string? SerialNumber);
public record AssignAssetRequest(Guid EmployeeId, DateOnly AssignedOn, string? Notes);
public record ReturnAssetRequest(DateOnly ReturnedOn, string? Condition, bool MarkAsRetired = false);
