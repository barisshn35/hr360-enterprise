using RecruitmentService.Tenancy;

namespace RecruitmentService.Models;

public enum ApplicationStatus
{
    Applied, Screening, Interview, Offer, Hired, Rejected, Withdrawn
}

public class Application : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid JobPostingId { get; set; }
    public JobPosting? JobPosting { get; set; }
    public Guid CandidateId { get; set; }
    public Candidate? Candidate { get; set; }
    public ApplicationStatus Status { get; set; } = ApplicationStatus.Applied;
    public string? Notes { get; set; }
    public DateTimeOffset AppliedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? StatusChangedAt { get; set; }
    public List<Interview> Interviews { get; set; } = new();
}
