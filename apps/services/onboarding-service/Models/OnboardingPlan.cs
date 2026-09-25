using OnboardingService.Tenancy;

namespace OnboardingService.Models;

public enum PlanStatus { NotStarted, InProgress, Completed, Cancelled }

public class OnboardingPlan : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EmployeeId { get; set; }
    public DateOnly StartDate { get; set; }
    public string? TemplateName { get; set; }
    public PlanStatus Status { get; set; } = PlanStatus.NotStarted;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public List<OnboardingTask> Tasks { get; set; } = new();
}
