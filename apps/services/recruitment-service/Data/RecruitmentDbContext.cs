using Microsoft.EntityFrameworkCore;
using RecruitmentService.Models;
using RecruitmentService.Tenancy;

namespace RecruitmentService.Data;

public class RecruitmentDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public RecruitmentDbContext(DbContextOptions<RecruitmentDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<JobPosting> JobPostings => Set<JobPosting>();
    public DbSet<Candidate> Candidates => Set<Candidate>();
    public DbSet<Application> Applications => Set<Application>();
    public DbSet<Interview> Interviews => Set<Interview>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<JobPosting>().ConfigureTenantColumn();
        modelBuilder.Entity<JobPosting>().ToTable("recruitment_job_postings");
        modelBuilder.Entity<JobPosting>().Property(p => p.Status).HasConversion<string>();
        modelBuilder.Entity<JobPosting>().Property(p => p.EmploymentType).HasConversion<string>();

        modelBuilder.Entity<Candidate>().ConfigureTenantColumn();
        modelBuilder.Entity<Candidate>().ToTable("recruitment_candidates");
        modelBuilder.Entity<Candidate>().HasIndex(c => new { c.TenantSlug, c.Email }).IsUnique();

        modelBuilder.Entity<Application>().ConfigureTenantColumn();
        modelBuilder.Entity<Application>().ToTable("recruitment_applications");
        modelBuilder.Entity<Application>().Property(a => a.Status).HasConversion<string>();
        modelBuilder.Entity<Application>()
            .HasOne(a => a.JobPosting).WithMany(p => p.Applications)
            .HasForeignKey(a => a.JobPostingId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Application>()
            .HasOne(a => a.Candidate).WithMany(c => c.Applications)
            .HasForeignKey(a => a.CandidateId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Application>()
            .HasIndex(a => new { a.JobPostingId, a.CandidateId }).IsUnique();

        modelBuilder.Entity<Interview>().ConfigureTenantColumn();
        modelBuilder.Entity<Interview>().ToTable("recruitment_interviews");
        modelBuilder.Entity<Interview>().Property(i => i.Type).HasConversion<string>();
        modelBuilder.Entity<Interview>().Property(i => i.Result).HasConversion<string>();
        modelBuilder.Entity<Interview>()
            .HasOne(i => i.Application).WithMany(a => a.Interviews)
            .HasForeignKey(i => i.ApplicationId).OnDelete(DeleteBehavior.Cascade);
    
        modelBuilder.ApplyTenantFilters(this);
    }
}
