using LearningService.Tenancy;

namespace LearningService.Models;

public class Certification : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid EmployeeId { get; set; }
    public required string Name { get; set; }
    public string? Issuer { get; set; }
    public string? CredentialId { get; set; }
    public DateOnly IssuedOn { get; set; }
    public DateOnly? ExpiresOn { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
