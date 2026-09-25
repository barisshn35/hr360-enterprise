using RecruitmentService.Tenancy;

namespace RecruitmentService.Models;

public enum JobPostingStatus { Draft, Published, OnHold, Closed }
public enum EmploymentType { FullTime, PartTime, Contract, Intern }

public class JobPosting : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Title { get; set; }
    /// <summary>Organization Service'teki departmana ID referansi.</summary>
    public Guid DepartmentId { get; set; }
    public string? Description { get; set; }
    public EmploymentType EmploymentType { get; set; } = EmploymentType.FullTime;
    public JobPostingStatus Status { get; set; } = JobPostingStatus.Draft;
    public int Headcount { get; set; } = 1;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? PublishedAt { get; set; }
    public DateTimeOffset? ClosedAt { get; set; }
    public List<Application> Applications { get; set; } = new();
}
