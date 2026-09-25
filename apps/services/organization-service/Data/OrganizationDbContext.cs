using Microsoft.EntityFrameworkCore;
using OrganizationService.Models;
using OrganizationService.Tenancy;

namespace OrganizationService.Data;

public class OrganizationDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public OrganizationDbContext(DbContextOptions<OrganizationDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<Company> Companies => Set<Company>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<Team> Teams => Set<Team>();
    public DbSet<TeamMember> TeamMembers => Set<TeamMember>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Company>().ConfigureTenantColumn();
        modelBuilder.Entity<Department>().ConfigureTenantColumn();

        modelBuilder.Entity<Company>().ToTable("organization_companies");
        modelBuilder.Entity<Department>().ToTable("organization_departments");

        modelBuilder.Entity<Department>()
            .HasOne(d => d.Company)
            .WithMany(c => c.Departments)
            .HasForeignKey(d => d.CompanyId)
            .OnDelete(DeleteBehavior.Cascade);

        // --- Ekipler ---
        modelBuilder.Entity<Team>().ConfigureTenantColumn();
        modelBuilder.Entity<TeamMember>().ConfigureTenantColumn();
        modelBuilder.Entity<Team>().ToTable("organization_teams");
        modelBuilder.Entity<TeamMember>().ToTable("organization_team_members");

        modelBuilder.Entity<Team>()
            .HasOne(t => t.Department).WithMany()
            .HasForeignKey(t => t.DepartmentId).OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<TeamMember>()
            .HasOne(m => m.Team).WithMany(t => t.Members)
            .HasForeignKey(m => m.TeamId).OnDelete(DeleteBehavior.Cascade);

        // IsCurrent hesaplanan ozellik, kolon degil.
        modelBuilder.Entity<TeamMember>().Ignore(m => m.IsCurrent);

        modelBuilder.Entity<Team>().HasIndex(t => t.DepartmentId);
        modelBuilder.Entity<TeamMember>().HasIndex(m => m.EmployeeId);

        modelBuilder.ApplyTenantFilters(this);
    }
}
