using RecruitmentService.Tenancy;

namespace RecruitmentService.Models;

public class Candidate : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public required string FirstName { get; set; }
    public required string LastName { get; set; }
    public required string Email { get; set; }
    public string? Phone { get; set; }
    /// <summary>Ozgecmis dosyasinin MinIO storage anahtari.</summary>
    public string? ResumeStorageKey { get; set; }
    public string? Source { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<Application> Applications { get; set; } = new();
}
