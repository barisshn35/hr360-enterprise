using RecruitmentService.Tenancy;

namespace RecruitmentService.Models;

public enum InterviewType { Phone, Technical, HR, Final }
public enum InterviewResult { Pending, Pass, Fail, NoShow }

public class Interview : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ApplicationId { get; set; }
    public Application? Application { get; set; }
    public InterviewType Type { get; set; }
    public DateTimeOffset ScheduledAt { get; set; }
    /// <summary>Employee Service'teki gorusmeciye ID referansi.</summary>
    public Guid InterviewerEmployeeId { get; set; }
    public InterviewResult Result { get; set; } = InterviewResult.Pending;
    public int? Score { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
