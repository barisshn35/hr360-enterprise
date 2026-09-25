using WorkflowService.Tenancy;

namespace WorkflowService.Models;

public enum StepDecision
{
    Pending,
    Approved,
    Rejected,
    Delegated
}

public class ApprovalStep : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid WorkflowRequestId { get; set; }
    public WorkflowRequest? WorkflowRequest { get; set; }
    public int Order { get; set; }
    public Guid ApproverEmployeeId { get; set; }
    public Guid? DelegatedToEmployeeId { get; set; }
    public StepDecision Decision { get; set; } = StepDecision.Pending;
    public string? Comment { get; set; }
    public DateTimeOffset? DecidedAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
