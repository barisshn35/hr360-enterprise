using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LearningService.Data;
using LearningService.Models;

namespace LearningService.Controllers;

[ApiController]
[Route("api/courses")]
[Authorize]
public class CoursesController : ControllerBase
{
    private readonly LearningDbContext _db;
    public CoursesController(LearningDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] CourseCategory? category, [FromQuery] bool? mandatoryOnly)
    {
        var q = _db.Courses.Where(c => c.IsActive);
        if (category.HasValue) q = q.Where(c => c.Category == category.Value);
        if (mandatoryOnly == true) q = q.Where(c => c.IsMandatory);
        return Ok(await q.OrderBy(c => c.Title).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var c = await _db.Courses.Include(x => x.Enrollments).FirstOrDefaultAsync(x => x.Id == id);
        return c is null ? NotFound() : Ok(c);
    }

    [HttpPost]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Create([FromBody] CreateCourseRequest request)
    {
        var course = new Course
        {
            Title = request.Title,
            Description = request.Description,
            Provider = request.Provider,
            DurationHours = request.DurationHours,
            Category = request.Category,
            IsMandatory = request.IsMandatory
        };
        _db.Courses.Add(course);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = course.Id }, course);
    }

    [HttpPost("{id}/enroll")]
    public async Task<IActionResult> Enroll(Guid id, [FromBody] EnrollRequest request)
    {
        var course = await _db.Courses.FirstOrDefaultAsync(c => c.Id == id);
        if (course is null) return NotFound("Egitim bulunamadi");
        if (!course.IsActive) return BadRequest("Pasif eğitime kayıt yapılamaz");

        if (await _db.Enrollments.AnyAsync(e => e.CourseId == id && e.EmployeeId == request.EmployeeId))
            return Conflict("Bu çalışan bu eğitime zaten kayıtlı");

        var enrollment = new Enrollment { CourseId = id, EmployeeId = request.EmployeeId };
        _db.Enrollments.Add(enrollment);
        await _db.SaveChangesAsync();
        return Created($"/api/courses/{id}", enrollment);
    }

    [HttpPost("{id}/enrollments/{enrollmentId}/complete")]
    public async Task<IActionResult> Complete(
        Guid id, Guid enrollmentId, [FromBody] CompleteEnrollmentRequest request)
    {
        var e = await _db.Enrollments
            .FirstOrDefaultAsync(x => x.Id == enrollmentId && x.CourseId == id);
        if (e is null) return NotFound();

        e.Status = request.Passed ? EnrollmentStatus.Completed : EnrollmentStatus.Failed;
        e.Score = request.Score;
        e.CompletedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(e);
    }

    /// <summary>Zorunlu egitimlerde uyum durumu - kim hangi egitimi tamamlamamis.</summary>
    [HttpGet("compliance")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> GetCompliance()
    {
        var mandatory = await _db.Courses
            .Where(c => c.IsMandatory && c.IsActive)
            .Include(c => c.Enrollments)
            .ToListAsync();

        return Ok(mandatory.Select(c => new
        {
            courseId = c.Id,
            title = c.Title,
            enrolled = c.Enrollments.Count,
            completed = c.Enrollments.Count(e => e.Status == EnrollmentStatus.Completed),
            pending = c.Enrollments.Count(e => e.Status != EnrollmentStatus.Completed)
        }));
    }
}

public record CreateCourseRequest(
    string Title, string? Description, string? Provider,
    decimal DurationHours, CourseCategory Category, bool IsMandatory);
public record EnrollRequest(Guid EmployeeId);
public record CompleteEnrollmentRequest(bool Passed, decimal? Score);
