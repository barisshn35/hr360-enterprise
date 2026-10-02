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
/// Type (izin turu) ve Days (is gunu) governance kural motorunun tetikleyici
/// katalogunda vardir ("5 gunden uzun izin" gibi kurallar bunlara bakar); sona
/// eklendikleri icin eski tuketiciler etkilenmez.
public record LeaveDecidedEvent(
    string TenantSlug, Guid LeaveRequestId, Guid EmployeeId,
    DateOnly StartDate, DateOnly EndDate, bool Approved, DateTimeOffset OccurredAt,
    string? Type = null, decimal? Days = null);
