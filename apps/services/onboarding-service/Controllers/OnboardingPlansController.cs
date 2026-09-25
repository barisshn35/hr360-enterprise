using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OnboardingService.Data;
using OnboardingService.Models;

namespace OnboardingService.Controllers;

[ApiController]
[Route("api/onboarding-plans")]
[Authorize]
public class OnboardingPlansController : ControllerBase
{
    private readonly OnboardingDbContext _db;
    public OnboardingPlansController(OnboardingDbContext db) => _db = db;

    /// <summary>Standart ise baslangic gorevleri - plan olusturulurken otomatik eklenir.</summary>
    private static readonly (string Title, TaskCategory Category, int Offset)[] DefaultTasks =
    {
        ("Kullanıcı hesabı ve e-posta açılması", TaskCategory.IT, 0),
        ("Donanim zimmeti (laptop, telefon)", TaskCategory.IT, 0),
        ("Bina giris kartinin hazirlanmasi", TaskCategory.Facility, 0),
        ("Ozluk evraklarinin toplanmasi", TaskCategory.HR, 1),
        ("Is sozlesmesinin imzalanmasi", TaskCategory.Legal, 1),
        ("Ise uyum egitimi", TaskCategory.Training, 3),
        ("Ekip tanistirma toplantisi", TaskCategory.HR, 1),
        ("Is sagligi ve guvenligi egitimi", TaskCategory.Training, 7),
    };

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId, [FromQuery] PlanStatus? status)
    {
        var q = _db.Plans.Include(p => p.Tasks).AsQueryable();
        if (employeeId.HasValue) q = q.Where(p => p.EmployeeId == employeeId.Value);
        if (status.HasValue) q = q.Where(p => p.Status == status.Value);
        return Ok(await q.OrderByDescending(p => p.CreatedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var p = await _db.Plans
            .Include(x => x.Tasks.OrderBy(t => t.Order))
            .FirstOrDefaultAsync(x => x.Id == id);
        return p is null ? NotFound() : Ok(p);
    }

    [HttpPost]
    [Authorize(Policy = "RequireOnboardingManage")]
    public async Task<IActionResult> Create([FromBody] CreatePlanRequest request)
    {
        var plan = new OnboardingPlan
        {
            EmployeeId = request.EmployeeId,
            StartDate = request.StartDate,
            TemplateName = request.TemplateName ?? "Standart",
            Status = PlanStatus.InProgress
        };

        if (request.UseDefaultTasks)
        {
            var order = 1;
            foreach (var (title, category, offset) in DefaultTasks)
            {
                plan.Tasks.Add(new OnboardingTask
                {
                    Title = title,
                    Category = category,
                    DueDate = request.StartDate.AddDays(offset),
                    Order = order++
                });
            }
        }

        _db.Plans.Add(plan);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = plan.Id }, plan);
    }

    [HttpPost("{id}/tasks")]
    [Authorize(Policy = "RequireOnboardingManage")]
    public async Task<IActionResult> AddTask(Guid id, [FromBody] AddTaskRequest request)
    {
        var plan = await _db.Plans.Include(p => p.Tasks).FirstOrDefaultAsync(p => p.Id == id);
        if (plan is null) return NotFound();

        var task = new OnboardingTask
        {
            PlanId = id,
            Title = request.Title,
            Category = request.Category,
            DueDate = request.DueDate,
            AssigneeEmployeeId = request.AssigneeEmployeeId,
            Order = plan.Tasks.Count + 1
        };
        _db.Tasks.Add(task);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id }, task);
    }

    [HttpPost("{id}/tasks/{taskId}/status")]
    public async Task<IActionResult> UpdateTaskStatus(
        Guid id, Guid taskId, [FromBody] UpdateTaskStatusRequest request)
    {
        var task = await _db.Tasks.FirstOrDefaultAsync(t => t.Id == taskId && t.PlanId == id);
        if (task is null) return NotFound();

        task.Status = request.Status;
        task.CompletedAt = request.Status == OnboardingTaskStatus.Done ? DateTimeOffset.UtcNow : null;
        await _db.SaveChangesAsync();

        // Tum gorevler bitince plani kapat.
        var plan = await _db.Plans.Include(p => p.Tasks).FirstAsync(p => p.Id == id);
        if (plan.Tasks.All(t => t.Status == OnboardingTaskStatus.Done))
        {
            plan.Status = PlanStatus.Completed;
            plan.CompletedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(task);
    }
}

public record CreatePlanRequest(
    Guid EmployeeId, DateOnly StartDate, string? TemplateName, bool UseDefaultTasks = true);
public record AddTaskRequest(
    string Title, TaskCategory Category, DateOnly? DueDate, Guid? AssigneeEmployeeId);
public record UpdateTaskStatusRequest(OnboardingTaskStatus Status);
