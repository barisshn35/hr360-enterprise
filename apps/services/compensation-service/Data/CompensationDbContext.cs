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
    public DbSet<PayrollExport> PayrollExports => Set<PayrollExport>();
    public DbSet<SalaryAdvance> Advances => Set<SalaryAdvance>();
    public DbSet<BenefitPlan> BenefitPlans => Set<BenefitPlan>();
    public DbSet<BenefitOption> BenefitOptions => Set<BenefitOption>();
    public DbSet<BenefitElection> BenefitElections => Set<BenefitElection>();
    public DbSet<RaiseCycle> RaiseCycles => Set<RaiseCycle>();
    public DbSet<RaiseProposal> RaiseProposals => Set<RaiseProposal>();

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
        modelBuilder.Entity<Payslip>().Property(p => p.AnomalyFlagsJson).HasColumnName("AnomalyFlags").HasColumnType("jsonb");

        modelBuilder.Entity<PayrollExport>().ConfigureTenantColumn();
        modelBuilder.Entity<PayrollExport>().ToTable("compensation_payroll_exports");
        modelBuilder.Entity<SalaryAdvance>().ConfigureTenantColumn();
        modelBuilder.Entity<SalaryAdvance>().ToTable("compensation_advances");
        modelBuilder.Entity<SalaryAdvance>().Property(a => a.Status).HasConversion<string>();
        modelBuilder.Entity<BenefitPlan>().ConfigureTenantColumn();
        modelBuilder.Entity<BenefitPlan>().ToTable("compensation_benefit_plans");
        modelBuilder.Entity<BenefitPlan>().HasIndex(p => new { p.TenantSlug, p.Year }).IsUnique();
        modelBuilder.Entity<BenefitOption>().ConfigureTenantColumn();
        modelBuilder.Entity<BenefitOption>().ToTable("compensation_benefit_options");
        modelBuilder.Entity<BenefitElection>().ConfigureTenantColumn();
        modelBuilder.Entity<BenefitElection>().ToTable("compensation_benefit_elections");
        modelBuilder.Entity<BenefitElection>().HasIndex(e => new { e.PlanId, e.EmployeeId }).IsUnique();
        modelBuilder.Entity<RaiseCycle>().ConfigureTenantColumn();
        modelBuilder.Entity<RaiseCycle>().ToTable("compensation_raise_cycles");
        modelBuilder.Entity<RaiseCycle>().Property(c => c.Status).HasConversion<string>();
        modelBuilder.Entity<RaiseProposal>().ConfigureTenantColumn();
        modelBuilder.Entity<RaiseProposal>().ToTable("compensation_raise_proposals");
        modelBuilder.Entity<RaiseProposal>().Property(c => c.Status).HasConversion<string>();
        modelBuilder.Entity<RaiseProposal>().HasIndex(p => new { p.CycleId, p.EmployeeId }).IsUnique();

        modelBuilder.ApplyTenantFilters(this);
    }
}
