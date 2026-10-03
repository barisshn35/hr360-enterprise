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
    public DbSet<PayrollPeriod> PayrollPeriods => Set<PayrollPeriod>();
    public DbSet<PayrollParameterSet> PayrollParameters => Set<PayrollParameterSet>();
    public DbSet<PayrollAdjustment> PayrollAdjustments => Set<PayrollAdjustment>();
    public DbSet<Payslip> Payslips => Set<Payslip>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SalaryBand>().ConfigureTenantColumn();
        modelBuilder.Entity<SalaryBand>().ToTable("compensation_salary_bands");
        modelBuilder.Entity<SalaryBand>().HasIndex(b => new { b.TenantSlug, b.Grade, b.Year }).IsUnique();

        modelBuilder.Entity<CompensationRecord>().ConfigureTenantColumn();
        modelBuilder.Entity<CompensationRecord>().ToTable("compensation_records");
        modelBuilder.Entity<CompensationRecord>().Property(r => r.Reason).HasConversion<string>();
        modelBuilder.Entity<CompensationRecord>().HasIndex(r => r.EmployeeId);

        modelBuilder.Entity<PayrollPeriod>().ConfigureTenantColumn();
        modelBuilder.Entity<PayrollPeriod>().ToTable("compensation_payroll_periods");
        modelBuilder.Entity<PayrollPeriod>().Property(p => p.Status).HasConversion<string>();
        modelBuilder.Entity<PayrollPeriod>().HasIndex(p => new { p.TenantSlug, p.Year, p.Month }).IsUnique();

        modelBuilder.Entity<PayrollParameterSet>().ConfigureTenantColumn();
        modelBuilder.Entity<PayrollParameterSet>().ToTable("compensation_payroll_parameters");
        modelBuilder.Entity<PayrollParameterSet>().HasIndex(p => new { p.TenantSlug, p.Year }).IsUnique();

        modelBuilder.Entity<PayrollAdjustment>().ConfigureTenantColumn();
        modelBuilder.Entity<PayrollAdjustment>().ToTable("compensation_payroll_adjustments");
        modelBuilder.Entity<PayrollAdjustment>().Property(a => a.Kind).HasConversion<string>();
        modelBuilder.Entity<PayrollAdjustment>().HasIndex(a => new { a.PeriodId, a.EmployeeId });

        modelBuilder.Entity<Payslip>().ConfigureTenantColumn();
        modelBuilder.Entity<Payslip>().ToTable("compensation_payslips");
        modelBuilder.Entity<Payslip>().HasIndex(p => new { p.PeriodId, p.EmployeeId }).IsUnique();
        modelBuilder.Entity<Payslip>().HasIndex(p => new { p.EmployeeId, p.Year });

        modelBuilder.ApplyTenantFilters(this);
    }
}
