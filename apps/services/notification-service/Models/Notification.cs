using NotificationService.Tenancy;

namespace NotificationService.Models;

public enum NotificationStatus { Pending, Sent, Failed, Read }

public class Notification : ITenantOwned
{
    public string TenantSlug { get; set; } = "";
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipientEmployeeId { get; set; }
    /// <summary>
    /// Olay kaynagi (orn. employee.hired) e-postayi zaten tasiyorsa buraya
    /// kaydedilir. Bos ise, gonderim sirasinda EmailSenderWorker bunu
    /// employee-service'ten RecipientEmployeeId ile sorup doldurur.
    /// </summary>
    public string? RecipientEmail { get; set; }
    public NotificationChannel Channel { get; set; } = NotificationChannel.InApp;
    public string? TemplateCode { get; set; }
    public string? Subject { get; set; }
    public required string Body { get; set; }
    public NotificationStatus Status { get; set; } = NotificationStatus.Pending;
    public string? FailureReason { get; set; }
    public int AttemptCount { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? SentAt { get; set; }
    public DateTimeOffset? ReadAt { get; set; }
}
