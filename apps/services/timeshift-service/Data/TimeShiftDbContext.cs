using Microsoft.EntityFrameworkCore;
using TimeShiftService.Messaging;
using TimeShiftService.Models;
using TimeShiftService.Tenancy;

namespace TimeShiftService.Data;

public class TimeShiftDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public TimeShiftDbContext(DbContextOptions<TimeShiftDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ShiftAssignment> ShiftAssignments => Set<ShiftAssignment>();
    public DbSet<TimeEntry> TimeEntries => Set<TimeEntry>();
    public DbSet<ShiftPattern> ShiftPatterns => Set<ShiftPattern>();
    public DbSet<ShiftPatternDay> ShiftPatternDays => Set<ShiftPatternDay>();
    public DbSet<ShiftTeam> ShiftTeams => Set<ShiftTeam>();
    public DbSet<ShiftTeamMember> ShiftTeamMembers => Set<ShiftTeamMember>();
    public DbSet<ShiftOverride> ShiftOverrides => Set<ShiftOverride>();
    public DbSet<ProcessedEvent> ProcessedEvents => Set<ProcessedEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Shift>().ConfigureTenantColumn();
        modelBuilder.Entity<Shift>().ToTable("timeshift_shifts");

        modelBuilder.Entity<ShiftAssignment>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftAssignment>().ToTable("timeshift_assignments");
        modelBuilder.Entity<ShiftAssignment>()
            .HasOne(a => a.Shift).WithMany()
            .HasForeignKey(a => a.ShiftId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ShiftAssignment>()
            .HasIndex(a => new { a.EmployeeId, a.Date }).IsUnique();

        modelBuilder.Entity<TimeEntry>().ConfigureTenantColumn();
        modelBuilder.Entity<TimeEntry>().ToTable("timeshift_time_entries");
        modelBuilder.Entity<TimeEntry>().Property(t => t.Source).HasConversion<string>();
        modelBuilder.Entity<TimeEntry>()
            .HasIndex(t => new { t.EmployeeId, t.Date }).IsUnique();

        modelBuilder.Entity<ShiftPattern>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftPattern>().ToTable("timeshift_shift_patterns");

        modelBuilder.Entity<ShiftPatternDay>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftPatternDay>().ToTable("timeshift_shift_pattern_days");
        modelBuilder.Entity<ShiftPatternDay>().Property(d => d.Type).HasConversion<string>();
        modelBuilder.Entity<ShiftPatternDay>()
            .HasOne(d => d.ShiftPattern).WithMany(p => p.Days)
            .HasForeignKey(d => d.ShiftPatternId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ShiftPatternDay>()
            .HasIndex(d => new { d.ShiftPatternId, d.DayIndex }).IsUnique();

        modelBuilder.Entity<ShiftTeam>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftTeam>().ToTable("timeshift_shift_teams");
        modelBuilder.Entity<ShiftTeam>()
            .HasOne(t => t.ShiftPattern).WithMany()
            .HasForeignKey(t => t.ShiftPatternId).OnDelete(DeleteBehavior.Restrict);

        modelBuilder.Entity<ShiftTeamMember>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftTeamMember>().ToTable("timeshift_shift_team_members");
        modelBuilder.Entity<ShiftTeamMember>()
            .HasOne(m => m.ShiftTeam).WithMany(t => t.Members)
            .HasForeignKey(m => m.ShiftTeamId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ShiftTeamMember>()
            .HasIndex(m => new { m.EmployeeId, m.EffectiveFrom });

        modelBuilder.Entity<ShiftOverride>().ConfigureTenantColumn();
        modelBuilder.Entity<ShiftOverride>().ToTable("timeshift_shift_overrides");
        modelBuilder.Entity<ShiftOverride>().Property(o => o.Type).HasConversion<string>();
        modelBuilder.Entity<ShiftOverride>()
            .HasIndex(o => new { o.EmployeeId, o.Date }).IsUnique();

        // Kafka idempotency tablosu - TUM tuketici servisler bu ORTAK tabloyu
        // paylasir (Consumer sutunu hangi servisin isledigini ayirt eder).
        // TenantSlug yok, tenant filtrelerine dahil edilmemeli.
        modelBuilder.Entity<ProcessedEvent>().ToTable("messaging_processed_events");
        modelBuilder.Entity<ProcessedEvent>().HasKey(p => new { p.EventId, p.Consumer });

        modelBuilder.ApplyTenantFilters(this);
    }
}
