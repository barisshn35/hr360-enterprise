using Microsoft.EntityFrameworkCore;
using CompensationService.Models;
using CompensationService.Tenancy;

namespace CompensationService.Data;

public class CompensationDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public CompensationDbContext(DbContextOptions<CompensationDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<SalaryBand> SalaryBands => Set<SalaryBand>();
    public DbSet<CompensationRecord> Records => Set<CompensationRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SalaryBand>().ConfigureTenantColumn();
        modelBuilder.Entity<SalaryBand>().ToTable("compensation_salary_bands");
        modelBuilder.Entity<SalaryBand>().HasIndex(b => new { b.Grade, b.Year }).IsUnique();

        modelBuilder.Entity<CompensationRecord>().ConfigureTenantColumn();
        modelBuilder.Entity<CompensationRecord>().ToTable("compensation_records");
        modelBuilder.Entity<CompensationRecord>().Property(r => r.Reason).HasConversion<string>();
        modelBuilder.Entity<CompensationRecord>().HasIndex(r => r.EmployeeId);
    
        modelBuilder.ApplyTenantFilters(this);
    }
}
