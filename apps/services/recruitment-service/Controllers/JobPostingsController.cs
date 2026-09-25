using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RecruitmentService.Data;
using RecruitmentService.Models;

namespace RecruitmentService.Controllers;

[ApiController]
[Route("api/job-postings")]
[Authorize]
public class JobPostingsController : ControllerBase
{
    private readonly RecruitmentDbContext _db;
    public JobPostingsController(RecruitmentDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] JobPostingStatus? status)
    {
        var q = _db.JobPostings.AsQueryable();
        if (status.HasValue) q = q.Where(p => p.Status == status.Value);
        return Ok(await q.OrderByDescending(p => p.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await _db.JobPostings
            .Include(x => x.Applications).ThenInclude(a => a.Candidate)
            .FirstOrDefaultAsync(x => x.Id == id);
        return p is null ? NotFound() : Ok(p);
    }

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create([FromBody] CreateJobPostingRequest request)
    {
        var posting = new JobPosting
        {
            Title = request.Title,
            DepartmentId = request.DepartmentId,
            Description = request.Description,
            EmploymentType = request.EmploymentType,
            Headcount = request.Headcount <= 0 ? 1 : request.Headcount
        };
        _db.JobPostings.Add(posting);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = posting.Id }, posting);
    }

    [HttpPost("{id}/publish")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Publish(Guid id)
    {
        var p = await _db.JobPostings.FirstOrDefaultAsync(x => x.Id == id);
        if (p is null) return NotFound();
        if (p.Status == JobPostingStatus.Closed) return BadRequest("Kapali ilan yayinlanamaz");

        p.Status = JobPostingStatus.Published;
        p.PublishedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(p);
    }

    [HttpPost("{id}/close")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Close(Guid id)
    {
        var p = await _db.JobPostings.FirstOrDefaultAsync(x => x.Id == id);
        if (p is null) return NotFound();

        p.Status = JobPostingStatus.Closed;
        p.ClosedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(p);
    }
}

public record CreateJobPostingRequest(
    string Title, Guid DepartmentId, string? Description,
    EmploymentType EmploymentType, int Headcount);
