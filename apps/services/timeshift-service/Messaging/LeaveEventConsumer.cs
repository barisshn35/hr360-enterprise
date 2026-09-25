using System.Text.Json;
using TimeShiftService.Data;
using TimeShiftService.Models;

namespace TimeShiftService.Messaging;

/// <summary>
/// leave-service'in "leave.approved"/"leave.rejected" event'lerini dinler.
/// Onaylanan izin araligindaki HER GUN icin bir ShiftOverride (Type=Leave)
/// olusturur - kullanici elle bir sey yapmaz, izinli gunler otomatik
/// "izinli" gorunur ve vardiya hesaplamasinda pattern'in YERINE gecer.
/// </summary>
public class LeaveEventConsumer : KafkaConsumerBase
{
    public LeaveEventConsumer(IServiceProvider services, ILogger<LeaveEventConsumer> logger)
        : base(services, logger, "timeshift-service", "hr360.leave.events") { }

    protected override string ConsumerName => "timeshift-service";

    protected override async Task HandleAsync(
        string eventType, string payload, TimeShiftDbContext db, CancellationToken ct)
    {
        if (eventType != "leave.approved") return; // reddedilen icin yapilacak bir sey yok

        var evt = JsonSerializer.Deserialize<LeaveDecidedPayload>(payload,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        if (evt is null || !evt.Approved) return;

        for (var date = evt.StartDate; date <= evt.EndDate; date = date.AddDays(1))
        {
            var existing = await Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions
                .FirstOrDefaultAsync(db.ShiftOverrides
                    .Where(o => o.EmployeeId == evt.EmployeeId && o.Date == date), ct);

            if (existing is not null)
            {
                existing.Type = ShiftOverrideType.Leave;
                existing.Note = $"İzin talebi {evt.LeaveRequestId}";
                existing.IsSystemManaged = true;
                existing.StartTime = null;
                existing.EndTime = null;
            }
            else
            {
                db.ShiftOverrides.Add(new ShiftOverride
                {
                    EmployeeId = evt.EmployeeId,
                    Date = date,
                    Type = ShiftOverrideType.Leave,
                    Note = $"İzin talebi {evt.LeaveRequestId}",
                    IsSystemManaged = true,
                });
            }
        }

        Logger.LogInformation(
            "İzin onayı işlendi: çalışan {EmployeeId}, {Start} - {End} arası izinli işaretlendi",
            evt.EmployeeId, evt.StartDate, evt.EndDate);
    }

    private record LeaveDecidedPayload(
        string TenantSlug, Guid LeaveRequestId, Guid EmployeeId,
        DateOnly StartDate, DateOnly EndDate, bool Approved, DateTimeOffset OccurredAt);
}
