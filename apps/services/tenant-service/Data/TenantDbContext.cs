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
    public DbSet<ScimToken> ScimTokens => Set<ScimToken>();
    public DbSet<DirectorySettings> DirectorySettings => Set<DirectorySettings>();
    public DbSet<DirectoryUser> DirectoryUsers => Set<DirectoryUser>();
    public DbSet<CustomDomain> CustomDomains => Set<CustomDomain>();

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

        // Dalga 5d (Y26/G28) - tablolar scripts/sql/2026-10-09_directory_domain.sql'den gelir.
        // Bu tablolarda kiraci filtresi YOK: tum sorgular TenantSlug ile acikca filtrelenir.
        modelBuilder.Entity<ScimToken>().ToTable("tenant_scim_tokens");
        modelBuilder.Entity<DirectorySettings>().ToTable("tenant_directory_settings");
        modelBuilder.Entity<DirectoryUser>().ToTable("tenant_directory_users");
        modelBuilder.Entity<CustomDomain>().ToTable("tenant_custom_domains");
    }
}
