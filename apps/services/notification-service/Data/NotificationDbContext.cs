using Microsoft.EntityFrameworkCore;
using NotificationService.Messaging;
using NotificationService.Models;
using NotificationService.Tenancy;

namespace NotificationService.Data;

public class NotificationDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public NotificationDbContext(DbContextOptions<NotificationDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<NotificationTemplate> Templates => Set<NotificationTemplate>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ProcessedEvent> ProcessedEvents => Set<ProcessedEvent>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<NotificationTemplate>().ConfigureTenantColumn();
        modelBuilder.Entity<NotificationTemplate>().ToTable("notification_templates");
        modelBuilder.Entity<NotificationTemplate>().Property(t => t.Channel).HasConversion<string>();
        modelBuilder.Entity<NotificationTemplate>()
            .HasIndex(t => new { t.TenantSlug, t.Code, t.Channel, t.Locale }).IsUnique();

        modelBuilder.Entity<Notification>().ConfigureTenantColumn();
        modelBuilder.Entity<Notification>().ToTable("notification_messages");
        modelBuilder.Entity<Notification>().Property(n => n.Channel).HasConversion<string>();
        modelBuilder.Entity<Notification>().Property(n => n.Status).HasConversion<string>();
        modelBuilder.Entity<Notification>()
            .HasIndex(n => new { n.RecipientEmployeeId, n.Status });
    
                // Kafka idempotency tablosu - TUM tuketici servisler bu ORTAK tabloyu
        // paylasir (Consumer sutunu hangi servisin isledigini ayirt eder).
        // TenantSlug yok, tenant filtrelerine dahil edilmemeli.
        modelBuilder.Entity<ProcessedEvent>().ToTable("messaging_processed_events");
        modelBuilder.Entity<ProcessedEvent>().HasKey(p => new { p.EventId, p.Consumer });

        modelBuilder.ApplyTenantFilters(this);
    }
}
