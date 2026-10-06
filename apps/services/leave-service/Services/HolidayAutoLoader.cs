using Microsoft.EntityFrameworkCore;
using LeaveService.Data;
using LeaveService.Tenancy;

namespace LeaveService.Services;

/// <summary>
/// Madde 72: Türkiye resmî tatillerinin yıllık otomatik yüklenmesi. Günde bir kez (açılışta da) çalışır:
/// bu yıl Türkiye takvimini yüklemiş (29 Ekim kaydı olan) her şirket için, 1 Aralık'tan itibaren gelecek
/// yılın tatilleri — gelecek yıl için hiç tatil kaydı yoksa — gömülü tablodan (TurkishHolidays) eklenir.
/// İnternetten veri alınmaz. Kapatmak için LEAVE_HOLIDAY_AUTOLOAD=false.
/// </summary>
public sealed class HolidayAutoLoader : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<HolidayAutoLoader> _log;

    public HolidayAutoLoader(IServiceScopeFactory scopes, ILogger<HolidayAutoLoader> log)
    {
        _scopes = scopes; _log = log;
    }

    public static bool Enabled =>
        !string.Equals(Environment.GetEnvironmentVariable("LEAVE_HOLIDAY_AUTOLOAD"), "false", StringComparison.OrdinalIgnoreCase);

    /// <summary>Yükleme zamanı mı (saf): Aralık ayında gelecek yıl için.</summary>
    public static int? TargetYear(DateOnly today) => today.Month == 12 ? today.Year + 1 : null;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled) return;
        try { await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken); } catch (OperationCanceledException) { return; }
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunOnceAsync(DateOnly.FromDateTime(DateTime.UtcNow), stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _log.LogWarning("Resmî tatil otomatik yüklemesi yapılamadı: {Error}", ex.Message);
            }
            try { await Task.Delay(TimeSpan.FromHours(24), stoppingToken); } catch (OperationCanceledException) { return; }
        }
    }

    public async Task RunOnceAsync(DateOnly today, CancellationToken ct)
    {
        if (TargetYear(today) is not { } year) return;
        List<string> tenants;
        using (var scope = _scopes.CreateScope())
        {
            var t = scope.ServiceProvider.GetRequiredService<TenantContext>();
            t.IsPlatformAdmin = true;
            var db = scope.ServiceProvider.GetRequiredService<LeaveDbContext>();
            var oct29 = new DateOnly(today.Year, 10, 29);
            var have = await db.PublicHolidays.AsNoTracking().Where(h => h.Date == oct29).Select(h => h.TenantSlug).Distinct().ToListAsync(ct);
            var next = await db.PublicHolidays.AsNoTracking().Where(h => h.Date.Year == year).Select(h => h.TenantSlug).Distinct().ToListAsync(ct);
            tenants = have.Except(next).Where(s => !string.IsNullOrEmpty(s)).ToList();
        }
        foreach (var tenant in tenants)
        {
            using var scope = _scopes.CreateScope();
            var t = scope.ServiceProvider.GetRequiredService<TenantContext>();
            t.TenantSlug = tenant;
            t.IsPlatformAdmin = false;
            var db = scope.ServiceProvider.GetRequiredService<LeaveDbContext>();
            var (added, _, _) = await Controllers.PublicHolidaysController.SeedAsync(db, year, true, ct);
            _log.LogInformation("{Tenant}: {Year} resmî tatilleri otomatik yüklendi ({Added} gün)", tenant, year, added);
        }
    }
}
