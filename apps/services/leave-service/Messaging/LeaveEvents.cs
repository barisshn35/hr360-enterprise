namespace LeaveService.Messaging;

public static class LeaveTopics
{
    public const string Events = "hr360.leave.events";
}

/// <summary>
/// leave.approved / leave.rejected govdesi. timeshift-service bu sekli bekler
/// (izinli gunleri ShiftOverride olarak isaretler). Hem workflow karari
/// (WorkflowEventConsumer) hem de elle sonuclandirma (LeaveRequestsController.Resolve)
/// AYNI kaydi kullanir - onceden Resolve hic event yayinlamiyordu, elle onaylanan
/// izin vardiya planinda hic gorunmuyordu.
/// </summary>
public record LeaveDecidedEvent(
    string TenantSlug, Guid LeaveRequestId, Guid EmployeeId,
    DateOnly StartDate, DateOnly EndDate, bool Approved, DateTimeOffset OccurredAt);
