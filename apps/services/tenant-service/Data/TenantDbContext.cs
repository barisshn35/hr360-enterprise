using Microsoft.EntityFrameworkCore;
using TenantService.Models;

namespace TenantService.Data;

/// <summary>
/// DIKKAT: Bu context bilincli olarak tenant filtresi UYGULAMAZ.
/// Tenant tablosunun kendisi platform seviyesindedir; diger tum servisler
/// global query filter ile izole edilir.
/// </summary>
public class TenantDbContext : DbContext
{
    public TenantDbContext(DbContextOptions<TenantDbContext> options) : base(options) { }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<TenantProvisioningLog> ProvisioningLogs => Set<TenantProvisioningLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Tenant>().ToTable("platform_tenants");
        modelBuilder.Entity<Tenant>().Property(t => t.Status).HasConversion<string>();
        modelBuilder.Entity<Tenant>().Property(t => t.Plan).HasConversion<string>();
        modelBuilder.Entity<Tenant>().HasIndex(t => t.Slug).IsUnique();
        modelBuilder.Entity<Tenant>().HasIndex(t => t.AdminEmail);

        modelBuilder.Entity<TenantProvisioningLog>().ToTable("platform_tenant_provisioning_log");
        modelBuilder.Entity<TenantProvisioningLog>().Property(l => l.Step).HasConversion<string>();
        modelBuilder.Entity<TenantProvisioningLog>().HasIndex(l => l.TenantId);
    }
}
