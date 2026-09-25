using Microsoft.EntityFrameworkCore;
using LeaveService.Messaging;
using LeaveService.Models;
using LeaveService.Tenancy;

namespace LeaveService.Data;

public class LeaveDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public LeaveDbContext(DbContextOptions<LeaveDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<LeaveBalance> LeaveBalances => Set<LeaveBalance>();
    public DbSet<LeaveRequest> LeaveRequests => Set<LeaveRequest>();
    public DbSet<ProcessedEvent> ProcessedEvents => Set<ProcessedEvent>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<LeaveBalance>().ConfigureTenantColumn();
        modelBuilder.Entity<LeaveBalance>().ToTable("leave_balances");
        modelBuilder.Entity<LeaveBalance>().Property(b => b.Type).HasConversion<string>();
        modelBuilder.Entity<LeaveBalance>().Ignore(b => b.RemainingDays);
        modelBuilder.Entity<LeaveBalance>()
            .HasIndex(b => new { b.EmployeeId, b.Year, b.Type }).IsUnique();

        modelBuilder.Entity<LeaveRequest>().ConfigureTenantColumn();
        modelBuilder.Entity<LeaveRequest>().ToTable("leave_requests");
        modelBuilder.Entity<LeaveRequest>().Property(r => r.Type).HasConversion<string>();
        modelBuilder.Entity<LeaveRequest>().Property(r => r.Status).HasConversion<string>();
        modelBuilder.Entity<LeaveRequest>().HasIndex(r => r.EmployeeId);
        modelBuilder.Entity<LeaveRequest>().HasIndex(r => r.Status);
    
                // Kafka idempotency tablosu - TUM tuketici servisler bu ORTAK tabloyu
        // paylasir (Consumer sutunu hangi servisin isledigini ayirt eder).
        // TenantSlug yok, tenant filtrelerine dahil edilmemeli.
        modelBuilder.Entity<ProcessedEvent>().ToTable("messaging_processed_events");
        modelBuilder.Entity<ProcessedEvent>().HasKey(p => new { p.EventId, p.Consumer });

        // Outbox tablosu da ORTAK - TUM yayinlayan servisler paylasir.
        modelBuilder.Entity<OutboxMessage>().ToTable("messaging_outbox");
        modelBuilder.Entity<OutboxMessage>().HasIndex(m => new { m.PublishedAt, m.CreatedAt });

        modelBuilder.ApplyTenantFilters(this);
    }
}
