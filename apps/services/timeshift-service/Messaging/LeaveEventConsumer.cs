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

        // Savunma: leave-service artik 1 yili asan talebi kabul etmiyor; yine de bozuk
        // bir olay gun gun milyonlarca sorgu calistirip tuketiciyi kilitlemesin.
        if (evt.EndDate < evt.StartDate || evt.EndDate.DayNumber - evt.StartDate.DayNumber > 366)
        {
            Logger.LogError("Geçersiz izin aralığı, atlanıyor: {Start} - {End} ({Leave})",
                evt.StartDate, evt.EndDate, evt.LeaveRequestId);
            return;
        }

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
                // Bu satir mevcut olmayan (StampTenant sadece INSERT'te
                // calisir) bir kayittan geliyorsa TenantSlug zaten dogrudur;
                // yine de bos kalmis eski/bozuk bir kayitsa burada duzeltelim.
                if (string.IsNullOrEmpty(existing.TenantSlug)) existing.TenantSlug = evt.TenantSlug;
            }
            else
            {
                db.ShiftOverrides.Add(new ShiftOverride
                {
                    // Arka plan tuketicisinde (bu sinif) HTTP baglami/TenantContext
                    // yok, bu yuzden StampTenant() TenantSlug'i asla dolduramiyor
                    // (bkz. KafkaConsumerBase - tenantContext.IsPlatformAdmin=true
                    // yalnizca SORGULARI gecerli kilar, YENI kayitlara TenantSlug
                    // YAZMAZ). Elle olayin tasidigi TenantSlug'i kullaniyoruz - aksi
                    // halde bu satir TenantSlug="" ile olusur ve gercek (platform-admin
                    // olmayan) kiracı kullanicilarina HICBIR ZAMAN gorunmez (hardcore
                    // test, canli ikinci kullanici ile dogrulandi: Mehmet Demir'in
                    // rostersinde onaylanmis izin gorunmuyordu).
                    TenantSlug = evt.TenantSlug,
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
