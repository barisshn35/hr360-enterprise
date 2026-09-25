using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using RecruitmentService.Data;
using RecruitmentService.Models;

namespace RecruitmentService.Controllers;

[ApiController]
[Route("api/applications")]
[Authorize(Policy = "RequireManagerOrAbove")]
public class ApplicationsController : ControllerBase
{
    private readonly RecruitmentDbContext _db;
    public ApplicationsController(RecruitmentDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] Guid? jobPostingId, [FromQuery] ApplicationStatus? status)
    {
        var q = _db.Applications.Include(a => a.Candidate).AsQueryable();
        if (jobPostingId.HasValue) q = q.Where(a => a.JobPostingId == jobPostingId.Value);
        if (status.HasValue) q = q.Where(a => a.Status == status.Value);
        return Ok(await q.OrderByDescending(a => a.AppliedAt).ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var a = await _db.Applications
            .Include(x => x.Candidate).Include(x => x.JobPosting).Include(x => x.Interviews)
            .FirstOrDefaultAsync(x => x.Id == id);
        return a is null ? NotFound() : Ok(a);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateApplicationRequest request)
    {
        var posting = await _db.JobPostings.FirstOrDefaultAsync(p => p.Id == request.JobPostingId);
        if (posting is null) return BadRequest("Ilan bulunamadi");
        if (posting.Status != JobPostingStatus.Published)
            return BadRequest("Yalnizca yayindaki ilanlara basvuru alinabilir");

        if (!await _db.Candidates.AnyAsync(c => c.Id == request.CandidateId))
            return BadRequest("Aday bulunamadi");

        if (await _db.Applications.AnyAsync(a =>
                a.JobPostingId == request.JobPostingId && a.CandidateId == request.CandidateId))
            return Conflict("Bu aday bu ilana zaten basvurmus");

        var app = new Application
        {
            JobPostingId = request.JobPostingId,
            CandidateId = request.CandidateId,
            Notes = request.Notes
        };
        _db.Applications.Add(app);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = app.Id }, app);
    }

    /// <summary>Basvuruyu ise alim hunisinde bir sonraki asamaya tasir.</summary>
    [HttpPost("{id}/status")]
    public async Task<IActionResult> ChangeStatus(Guid id, [FromBody] ChangeStatusRequest request)
    {
        var app = await _db.Applications.FirstOrDefaultAsync(a => a.Id == id);
        if (app is null) return NotFound();
        if (app.Status is ApplicationStatus.Hired or ApplicationStatus.Rejected
                       or ApplicationStatus.Withdrawn)
            return BadRequest("Sonuclanmis basvurunun durumu degistirilemez");

        // NOT: Onceden herhangi bir gecis serbestti (Basvuru -> Ise alindi, kapali ilana
        // ise alim). Ise alim yalnizca Teklif asamasindan ve acik bir ilanda yapilir;
        // asamalar arasi geri tasima (yeniden degerlendirme) serbest birakildi.
        if (request.Status == app.Status)
            return BadRequest("Başvuru zaten bu aşamada");
        if (request.Status == ApplicationStatus.Hired)
        {
            if (app.Status != ApplicationStatus.Offer)
                return BadRequest("İşe alım yalnızca teklif aşamasındaki başvurudan yapılabilir");
            var posting = await _db.JobPostings.FirstOrDefaultAsync(p => p.Id == app.JobPostingId);
            if (posting is null || posting.Status == JobPostingStatus.Closed)
                return BadRequest("Kapalı ilana işe alım yapılamaz");
        }

        app.Status = request.Status;
        app.StatusChangedAt = DateTimeOffset.UtcNow;
        if (!string.IsNullOrWhiteSpace(request.Notes)) app.Notes = request.Notes;

        await _db.SaveChangesAsync();
        return Ok(app);
    }

    [HttpPost("{id}/interviews")]
    public async Task<IActionResult> ScheduleInterview(
        Guid id, [FromBody] ScheduleInterviewRequest request)
    {
        var app = await _db.Applications.FirstOrDefaultAsync(a => a.Id == id);
        if (app is null) return NotFound();

        var interview = new Interview
        {
            ApplicationId = id,
            Type = request.Type,
            ScheduledAt = request.ScheduledAt,
            InterviewerEmployeeId = request.InterviewerEmployeeId
        };
        _db.Interviews.Add(interview);

        if (app.Status == ApplicationStatus.Applied || app.Status == ApplicationStatus.Screening)
        {
            app.Status = ApplicationStatus.Interview;
            app.StatusChangedAt = DateTimeOffset.UtcNow;
        }

        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id }, interview);
    }

    [HttpPost("{id}/interviews/{interviewId}/result")]
    public async Task<IActionResult> RecordResult(
        Guid id, Guid interviewId, [FromBody] InterviewResultRequest request)
    {
        var interview = await _db.Interviews
            .FirstOrDefaultAsync(i => i.Id == interviewId && i.ApplicationId == id);
        if (interview is null) return NotFound();

        interview.Result = request.Result;
        interview.Score = request.Score;
        interview.Notes = request.Notes;
        await _db.SaveChangesAsync();
        return Ok(interview);
    }
}

public record CreateApplicationRequest(Guid JobPostingId, Guid CandidateId, string? Notes);
public record ChangeStatusRequest(ApplicationStatus Status, string? Notes);
public record ScheduleInterviewRequest(
    InterviewType Type, DateTimeOffset ScheduledAt, Guid InterviewerEmployeeId);
public record InterviewResultRequest(InterviewResult Result, int? Score, string? Notes);
