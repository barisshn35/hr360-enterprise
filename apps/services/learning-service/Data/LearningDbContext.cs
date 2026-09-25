using Microsoft.EntityFrameworkCore;
using LearningService.Models;
using LearningService.Tenancy;

namespace LearningService.Data;

public class LearningDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public LearningDbContext(DbContextOptions<LearningDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<Course> Courses => Set<Course>();
    public DbSet<Enrollment> Enrollments => Set<Enrollment>();
    public DbSet<Certification> Certifications => Set<Certification>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Course>().ConfigureTenantColumn();
        modelBuilder.Entity<Course>().ToTable("learning_courses");
        modelBuilder.Entity<Course>().Property(c => c.Category).HasConversion<string>();

        modelBuilder.Entity<Enrollment>().ConfigureTenantColumn();
        modelBuilder.Entity<Enrollment>().ToTable("learning_enrollments");
        modelBuilder.Entity<Enrollment>().Property(e => e.Status).HasConversion<string>();
        modelBuilder.Entity<Enrollment>()
            .HasOne(e => e.Course).WithMany(c => c.Enrollments)
            .HasForeignKey(e => e.CourseId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Enrollment>()
            .HasIndex(e => new { e.CourseId, e.EmployeeId }).IsUnique();

        modelBuilder.Entity<Certification>().ConfigureTenantColumn();
        modelBuilder.Entity<Certification>().ToTable("learning_certifications");
        modelBuilder.Entity<Certification>().HasIndex(c => c.EmployeeId);
    
        modelBuilder.ApplyTenantFilters(this);
    }
}
