using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RecruitmentService.Data;
using RecruitmentService.Models;

namespace RecruitmentService.Controllers;

[ApiController]
[Route("api/candidates")]
[Authorize(Policy = "RequireManagerOrAbove")]
public class CandidatesController : ControllerBase
{
    private readonly RecruitmentDbContext _db;
    public CandidatesController(RecruitmentDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? search)
    {
        var q = _db.Candidates.AsQueryable();
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            q = q.Where(c =>
                c.FirstName.ToLower().Contains(term) ||
                c.LastName.ToLower().Contains(term) ||
                c.Email.ToLower().Contains(term));
        }
        return Ok(await q.OrderByDescending(c => c.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var c = await _db.Candidates
            .Include(x => x.Applications).ThenInclude(a => a.Interviews)
            .FirstOrDefaultAsync(x => x.Id == id);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCandidateRequest request)
    {
        if (await _db.Candidates.AnyAsync(c => c.Email == request.Email))
            return Conflict("Bu e-posta ile kayıtlı aday zaten var");

        var candidate = new Candidate
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Email = request.Email,
            Phone = request.Phone,
            ResumeStorageKey = request.ResumeStorageKey,
            Source = request.Source
        };
        _db.Candidates.Add(candidate);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = candidate.Id }, candidate);
    }
}

public record CreateCandidateRequest(
    string FirstName, string LastName, string Email,
    string? Phone, string? ResumeStorageKey, string? Source);
