using Microsoft.EntityFrameworkCore;
using ExpenseService.Models;
using ExpenseService.Messaging;
using ExpenseService.Tenancy;

namespace ExpenseService.Data;

public class ExpenseDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public ExpenseDbContext(DbContextOptions<ExpenseDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<ExpenseClaim> Claims => Set<ExpenseClaim>();
    public DbSet<ExpenseItem> Items => Set<ExpenseItem>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<HrCase> Cases => Set<HrCase>();
    public DbSet<ProcessedEvent> ProcessedEvents => Set<ProcessedEvent>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ExpenseClaim>().ConfigureTenantColumn();
        modelBuilder.Entity<ExpenseClaim>().ToTable("expense_claims");
        modelBuilder.Entity<ExpenseClaim>().Property(c => c.Status).HasConversion<string>();
        modelBuilder.Entity<ExpenseClaim>().HasIndex(c => c.EmployeeId);

        modelBuilder.Entity<ExpenseItem>().ConfigureTenantColumn();
        modelBuilder.Entity<ExpenseItem>().ToTable("expense_items");
        modelBuilder.Entity<ExpenseItem>().Property(i => i.Category).HasConversion<string>();
        modelBuilder.Entity<ExpenseItem>()
            .HasOne(i => i.Claim).WithMany(c => c.Items)
            .HasForeignKey(i => i.ClaimId).OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Document>().ConfigureTenantColumn();
        modelBuilder.Entity<Document>().ToTable("expense_documents");
        modelBuilder.Entity<Document>().Property(d => d.Type).HasConversion<string>();
        modelBuilder.Entity<Document>().HasIndex(d => d.EmployeeId);

        modelBuilder.Entity<HrCase>().ConfigureTenantColumn();
        modelBuilder.Entity<HrCase>().ToTable("expense_hr_cases");
        modelBuilder.Entity<HrCase>().Property(c => c.Category).HasConversion<string>();
        modelBuilder.Entity<HrCase>().Property(c => c.Priority).HasConversion<string>();
        modelBuilder.Entity<HrCase>().Property(c => c.Status).HasConversion<string>();
        modelBuilder.Entity<HrCase>().HasIndex(c => c.Status);

        // Kafka idempotency ve outbox tablolari - TUM servisler bu ORTAK
        // tablolari paylasir (bkz. leave-service ile ayni desen).
        modelBuilder.Entity<ProcessedEvent>().ToTable("messaging_processed_events");
        modelBuilder.Entity<ProcessedEvent>().HasKey(p => new { p.EventId, p.Consumer });

        modelBuilder.Entity<OutboxMessage>().ToTable("messaging_outbox");
        modelBuilder.Entity<OutboxMessage>().HasIndex(m => new { m.PublishedAt, m.CreatedAt });

        modelBuilder.ApplyTenantFilters(this);
    }
}
