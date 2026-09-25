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

    /// <summary>
    /// NOT: Onceki halinde bu uc ham Asset entity'sini donuyordu -
    /// Asset'in AssignedEmployeeId/AssignedOn gibi duz (flat) alanlari HIC
    /// YOK (sadece List&lt;AssetAssignment&gt; Assignments var) ve bu uc
    /// Assignments'i Include ETMIYORDU. Frontend (AssetsPage.tsx "Zimmetli"
    /// sutunu) a.assignedEmployeeId/a.assignedOn okuyordu - HER ZAMAN
    /// undefined, yani zimmetli bir demirbas bile "—" (bos) gorunuyordu
    /// (hardcore test sirasinda bulundu, 3. tur). Acik (ReturnedOn == null)
    /// atama varsa duz alanlar olarak eklenir.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] AssetStatus? status, [FromQuery] AssetType? type)
    {
        var q = _db.Assets.AsQueryable();
        if (status.HasValue) q = q.Where(a => a.Status == status.Value);
        if (type.HasValue) q = q.Where(a => a.Type == type.Value);
        var assets = await q.OrderBy(a => a.AssetTag).ToListAsync();

        var openAssignments = await _db.AssetAssignments
            .Where(a => a.ReturnedOn == null)
            .ToDictionaryAsync(a => a.AssetId, a => a);

        return Ok(assets.Select(a =>
        {
            openAssignments.TryGetValue(a.Id, out var open);
            return new
            {
                a.Id, a.AssetTag, a.Type, a.Model, a.SerialNumber, a.Status, a.CreatedAt,
                AssignedEmployeeId = open?.EmployeeId,
                AssignedOn = open?.AssignedOn,
            };
        }));
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var a = await _db.Assets
            .Include(x => x.Assignments.OrderByDescending(s => s.AssignedOn))
            .FirstOrDefaultAsync(x => x.Id == id);
        if (a is null) return NotFound();

        var open = a.Assignments.FirstOrDefault(s => s.ReturnedOn == null);
        return Ok(new
        {
            a.Id, a.AssetTag, a.Type, a.Model, a.SerialNumber, a.Status, a.CreatedAt,
            AssignedEmployeeId = open?.EmployeeId,
            AssignedOn = open?.AssignedOn,
            Assignments = a.Assignments,
        });
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
