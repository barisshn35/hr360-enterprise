using Microsoft.EntityFrameworkCore;
using GovernanceService.Models;
using GovernanceService.Tenancy;

namespace GovernanceService.Data;

/// <summary>Yönetişim modülü tabloları (governance_*). Şema SQL göçüyle oluşturulur.</summary>
public class GovernanceDbContext : DbContext, ITenantAwareContext
{
    private readonly ITenantContext _tenant;

    public GovernanceDbContext(DbContextOptions<GovernanceDbContext> options, ITenantContext tenant)
        : base(options) => _tenant = tenant;

    public string? CurrentTenantSlug => _tenant.TenantSlug;
    public bool CurrentIsPlatformAdmin => _tenant.IsPlatformAdmin;

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        this.StampTenant(_tenant);
        return base.SaveChangesAsync(ct);
    }

    public DbSet<GovernanceEvent> Events => Set<GovernanceEvent>();
    public DbSet<Consent> Consents => Set<Consent>();
    public DbSet<DataRequest> DataRequests => Set<DataRequest>();
    public DbSet<RetentionPolicy> RetentionPolicies => Set<RetentionPolicy>();
    public DbSet<DocTemplate> DocTemplates => Set<DocTemplate>();
    public DbSet<Rule> Rules => Set<Rule>();
    public DbSet<RuleRun> RuleRuns => Set<RuleRun>();
    public DbSet<Webhook> Webhooks => Set<Webhook>();
    public DbSet<WebhookDelivery> WebhookDeliveries => Set<WebhookDelivery>();
    public DbSet<ApiKey> ApiKeys => Set<ApiKey>();
    public DbSet<Integration> Integrations => Set<Integration>();
    public DbSet<Invoice> Invoices => Set<Invoice>();
    public DbSet<CalendarFeed> CalendarFeeds => Set<CalendarFeed>();
    public DbSet<KbArticle> KbArticles => Set<KbArticle>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // Olaylar kiracıya göre elle filtrelenir (TenantSlug boş olabilir), ITenantOwned değil.
        b.Entity<GovernanceEvent>().ToTable("governance_events");
        b.Entity<Consent>().ToTable("governance_consents").ConfigureTenantColumn();
        b.Entity<DataRequest>().ToTable("governance_data_requests").ConfigureTenantColumn();
        b.Entity<RetentionPolicy>().ToTable("governance_retention_policies").ConfigureTenantColumn();
        b.Entity<DocTemplate>().ToTable("governance_doc_templates").ConfigureTenantColumn();
        b.Entity<Rule>().ToTable("governance_rules").ConfigureTenantColumn();
        b.Entity<Rule>().Property(x => x.Conditions).HasColumnType("jsonb");
        b.Entity<Rule>().Property(x => x.Actions).HasColumnType("jsonb");
        b.Entity<RuleRun>().ToTable("governance_rule_runs").ConfigureTenantColumn();
        b.Entity<Webhook>().ToTable("governance_webhooks").ConfigureTenantColumn();
        b.Entity<WebhookDelivery>().ToTable("governance_webhook_deliveries").ConfigureTenantColumn();
        b.Entity<ApiKey>().ToTable("governance_api_keys").ConfigureTenantColumn();
        b.Entity<Integration>().ToTable("governance_integrations").ConfigureTenantColumn();
        b.Entity<Invoice>().ToTable("governance_invoices").ConfigureTenantColumn();
        b.Entity<Invoice>().Property(x => x.UnitPrice).HasPrecision(12, 2);
        b.Entity<Invoice>().Property(x => x.Amount).HasPrecision(12, 2);
        b.Entity<Invoice>().Property(x => x.TaxAmount).HasPrecision(12, 2);
        b.Entity<Invoice>().Property(x => x.Total).HasPrecision(12, 2);
        b.Entity<CalendarFeed>().ToTable("governance_calendar_feeds").ConfigureTenantColumn();
        b.Entity<KbArticle>().ToTable("governance_kb_articles").ConfigureTenantColumn();

        b.ApplyTenantFilters(this);
    }
}
