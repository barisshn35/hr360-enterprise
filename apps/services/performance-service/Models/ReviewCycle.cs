using PerformanceService.Tenancy;

namespace PerformanceService.Models;

public enum CyclePeriod { Q1, Q2, Q3, Q4, H1, H2, Annual }
public enum CycleStatus { Planned, Open, InReview, Closed }

public class ReviewCycle : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string Name { get; set; }
    public int Year { get; set; }
    public CyclePeriod Period { get; set; }
    public DateOnly StartDate { get; set; }
    public DateOnly EndDate { get; set; }
    public CycleStatus Status { get; set; } = CycleStatus.Planned;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Goal> Goals { get; set; } = new();
}
