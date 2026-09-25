using Microsoft.EntityFrameworkCore;
using EmployeeService.Models;
using EmployeeService.Messaging;
using EmployeeService.Tenancy;

namespace EmployeeService.Data;

public class EmployeeDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public EmployeeDbContext(DbContextOptions<EmployeeDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<Employee> Employees => Set<Employee>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
    public DbSet<Assignment> Assignments => Set<Assignment>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<OutboxMessage>().ToTable("messaging_outbox");
        modelBuilder.Entity<OutboxMessage>().HasIndex(m => new { m.PublishedAt, m.CreatedAt });

        modelBuilder.Entity<Employee>().ConfigureTenantColumn();
        modelBuilder.Entity<Assignment>().ConfigureTenantColumn();

        modelBuilder.Entity<Employee>().ToTable("employee_employees");
        // Kiraci bazinda benzersiz: global benzersizlik, bir kiracinin baska bir kiracidaki
        // e-postayi "var mi?" diye yoklamasina (500 = var) ve sirket degistiren birinin
        // eklenememesine yol aciyordu. Buyuk/kucuk harf duyarsizligi SQL tarafinda (lower).
        modelBuilder.Entity<Employee>().HasIndex(e => new { e.TenantSlug, e.Email }).IsUnique();
        modelBuilder.Entity<Employee>().HasIndex(e => e.KeycloakUserId).IsUnique()
            .HasFilter("\"KeycloakUserId\" IS NOT NULL");
        modelBuilder.Entity<Employee>().Property(e => e.Status).HasConversion<string>();

        modelBuilder.Entity<Assignment>().ToTable("employee_assignments");
        modelBuilder.Entity<Assignment>()
            .HasOne(a => a.Employee)
            .WithMany(e => e.Assignments)
            .HasForeignKey(a => a.EmployeeId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.ApplyTenantFilters(this);
    }
}
