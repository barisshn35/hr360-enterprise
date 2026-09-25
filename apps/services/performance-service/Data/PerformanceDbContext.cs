using Microsoft.EntityFrameworkCore;
using PerformanceService.Models;
using PerformanceService.Tenancy;

namespace PerformanceService.Data;

public class PerformanceDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public PerformanceDbContext(DbContextOptions<PerformanceDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<ReviewCycle> Cycles => Set<ReviewCycle>();
    public DbSet<Goal> Goals => Set<Goal>();
    public DbSet<Review> Reviews => Set<Review>();
    public DbSet<MetricDefinition> Metrics => Set<MetricDefinition>();
    public DbSet<ScoringConfig> ScoringConfigs => Set<ScoringConfig>();
    public DbSet<ReviewScore> ReviewScores => Set<ReviewScore>();
    public DbSet<Feedback> Feedback => Set<Feedback>();
    public DbSet<PerformanceSnapshot> Snapshots => Set<PerformanceSnapshot>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ReviewCycle>().ConfigureTenantColumn();
        modelBuilder.Entity<ReviewCycle>().ToTable("performance_cycles");
        modelBuilder.Entity<ReviewCycle>().Property(c => c.Period).HasConversion<string>();
        modelBuilder.Entity<ReviewCycle>().Property(c => c.Status).HasConversion<string>();

        modelBuilder.Entity<Goal>().ConfigureTenantColumn();
        modelBuilder.Entity<Goal>().ToTable("performance_goals");
        modelBuilder.Entity<Goal>().Property(g => g.Status).HasConversion<string>();
        modelBuilder.Entity<Goal>()
            .HasOne(g => g.Cycle).WithMany(c => c.Goals)
            .HasForeignKey(g => g.CycleId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<Goal>().HasIndex(g => g.EmployeeId);

        modelBuilder.Entity<Review>().ConfigureTenantColumn();
        modelBuilder.Entity<Review>().ToTable("performance_reviews");
        modelBuilder.Entity<Review>().Property(r => r.Type).HasConversion<string>();
        modelBuilder.Entity<Review>().HasIndex(r => new { r.CycleId, r.EmployeeId });
    
        // --- Yapilandirilabilir degerlendirme modeli ---

        modelBuilder.Entity<MetricDefinition>().ConfigureTenantColumn();
        modelBuilder.Entity<MetricDefinition>().ToTable("performance_metrics");
        modelBuilder.Entity<MetricDefinition>().Property(m => m.Category).HasConversion<string>();
        modelBuilder.Entity<MetricDefinition>().Property(m => m.Scale).HasConversion<string>();
        // Kod kiraci icinde benzersiz - raporlarda sabit referans olarak kullaniliyor.
        modelBuilder.Entity<MetricDefinition>()
            .HasIndex(m => new { m.TenantSlug, m.Code }).IsUnique();

        modelBuilder.Entity<ScoringConfig>().ConfigureTenantColumn();
        modelBuilder.Entity<ScoringConfig>().ToTable("performance_scoring_config");
        modelBuilder.Entity<ScoringConfig>()
            .HasIndex(c => new { c.TenantSlug, c.Version }).IsUnique();

        modelBuilder.Entity<ReviewScore>().ConfigureTenantColumn();
        modelBuilder.Entity<ReviewScore>().ToTable("performance_review_scores");
        modelBuilder.Entity<ReviewScore>()
            .HasOne(s => s.Review).WithMany(r => r.Scores)
            .HasForeignKey(s => s.ReviewId).OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<ReviewScore>()
            .HasOne(s => s.Metric).WithMany()
            .HasForeignKey(s => s.MetricId).OnDelete(DeleteBehavior.Restrict);
        // Ayni degerlendirmede ayni metrik iki kez puanlanamaz.
        modelBuilder.Entity<ReviewScore>()
            .HasIndex(s => new { s.ReviewId, s.MetricId }).IsUnique();

        modelBuilder.Entity<Feedback>().ConfigureTenantColumn();
        modelBuilder.Entity<Feedback>().ToTable("performance_feedback");
        modelBuilder.Entity<Feedback>().Property(f => f.Reason).HasConversion<string>();
        modelBuilder.Entity<Feedback>().Property(f => f.Sentiment).HasConversion<string>();
        modelBuilder.Entity<Feedback>().HasIndex(f => f.ToEmployeeId);
        modelBuilder.Entity<Feedback>().HasIndex(f => f.FromEmployeeId);

        modelBuilder.Entity<PerformanceSnapshot>().ConfigureTenantColumn();
        modelBuilder.Entity<PerformanceSnapshot>().ToTable("performance_snapshots");
        modelBuilder.Entity<PerformanceSnapshot>().Property(s => s.Source).HasConversion<string>();
        // Trend sorgulari calisan + zaman uzerinden gidiyor.
        modelBuilder.Entity<PerformanceSnapshot>()
            .HasIndex(s => new { s.EmployeeId, s.CapturedAt });
        // Ekip karsilastirmasi ekip + zaman uzerinden.
        modelBuilder.Entity<PerformanceSnapshot>()
            .HasIndex(s => new { s.TeamId, s.CapturedAt });

        modelBuilder.ApplyTenantFilters(this);
    }
}
