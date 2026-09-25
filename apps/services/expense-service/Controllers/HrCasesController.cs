using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Models;

namespace ExpenseService.Controllers;

[ApiController]
[Route("api/hr-cases")]
[Authorize]
public class HrCasesController : ControllerBase
{
    private readonly ExpenseDbContext _db;
    public HrCasesController(ExpenseDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? employeeId, [FromQuery] CaseStatus? status, [FromQuery] CasePriority? priority)
    {
        var q = _db.Cases.AsQueryable();
        if (employeeId.HasValue) q = q.Where(c => c.EmployeeId == employeeId.Value);
        if (status.HasValue) q = q.Where(c => c.Status == status.Value);
        if (priority.HasValue) q = q.Where(c => c.Priority == priority.Value);
        return Ok(await q.OrderByDescending(c => c.Priority).ThenBy(c => c.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var c = await _db.Cases.FirstOrDefaultAsync(x => x.Id == id);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCaseRequest request)
    {
        var hrCase = new HrCase
        {
            EmployeeId = request.EmployeeId,
            Subject = request.Subject,
            Description = request.Description,
            Category = request.Category,
            Priority = request.Priority
        };
        _db.Cases.Add(hrCase);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = hrCase.Id }, hrCase);
    }

    [HttpPost("{id}/assign")]
    [Authorize(Policy = "RequireCaseManage")]
    public async Task<IActionResult> Assign(Guid id, [FromBody] AssignCaseRequest request)
    {
        var c = await _db.Cases.FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();

        c.AssignedToEmployeeId = request.AssignedToEmployeeId;
        if (c.Status == CaseStatus.Open) c.Status = CaseStatus.InProgress;
        await _db.SaveChangesAsync();
        return Ok(c);
    }

    [HttpPost("{id}/resolve")]
    [Authorize(Policy = "RequireCaseManage")]
    public async Task<IActionResult> Resolve(Guid id, [FromBody] ResolveCaseRequest request)
    {
        var c = await _db.Cases.FirstOrDefaultAsync(x => x.Id == id);
        if (c is null) return NotFound();
        if (c.Status is CaseStatus.Resolved or CaseStatus.Closed)
            return BadRequest("Vaka zaten sonuclanmis");

        c.Status = CaseStatus.Resolved;
        c.Resolution = request.Resolution;
        c.ResolvedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(c);
    }
}

public record CreateCaseRequest(
    Guid EmployeeId, string Subject, string? Description,
    CaseCategory Category, CasePriority Priority);
public record AssignCaseRequest(Guid AssignedToEmployeeId);
public record ResolveCaseRequest(string Resolution);
