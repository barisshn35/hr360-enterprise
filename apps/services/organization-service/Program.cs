using Prometheus;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using OrganizationService.Data;
using OrganizationService.Tenancy;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration["ConnectionStrings__OrganizationDb"]
    ?? Environment.GetEnvironmentVariable("ORG_DB_CONNECTION")
    ?? throw new InvalidOperationException("DB connection string not configured");

builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

builder.Services.AddDbContext<OrganizationDbContext>(options =>
    options.UseNpgsql(connectionString));

var keycloakAuthority = Environment.GetEnvironmentVariable("KEYCLOAK_AUTHORITY")
    ?? "http://172.33.55.2:8080/realms/hr360";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.RequireHttpsMetadata = false; // ic ag, VPN arkasinda
        options.MetadataAddress = keycloakAuthority + "/.well-known/openid-configuration";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = true,
            ValidIssuer = keycloakAuthority,
        };
        // Keycloak realm_access.roles claim'ini ASP.NET Core'un ClaimTypes.Role'une esler.
        // Bu olmadan [Authorize(Roles=...)] ve role-based policy'ler HICBIR ZAMAN calismaz,
        // cunku Keycloak rolleri duz "role" claim'i olarak degil, ic ice JSON olarak gelir.
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                var identity = context.Principal?.Identity as ClaimsIdentity;
                if (identity == null) return Task.CompletedTask;

                var realmAccessClaim = identity.FindFirst("realm_access")?.Value;
                if (string.IsNullOrEmpty(realmAccessClaim)) return Task.CompletedTask;

                try
                {
                    using var doc = JsonDocument.Parse(realmAccessClaim);
                    if (doc.RootElement.TryGetProperty("roles", out var rolesElement))
                    {
                        foreach (var role in rolesElement.EnumerateArray())
                        {
                            var roleName = role.GetString();
                            if (!string.IsNullOrEmpty(roleName))
                            {
                                identity.AddClaim(new Claim(ClaimTypes.Role, roleName));
                            }
                        }
                    }
                }
                catch (JsonException)
                {
                    // realm_access parse edilemedi, rol eklenmeden devam
                }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    // RequireHrAdmin bu serviste sadece CompaniesController+DepartmentsController'i
    // (organization:manage), RequireManagerOrAbove sadece TeamsController'i
    // (team:manage) koruyor - roles.ts'te sirasiyla tek bir ize karsilik
    // geliyorlar.
    options.AddPolicy("RequireHrAdmin", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("hr-admin") || ctx.User.IsInRole("tenant-admin") ||
            ctx.User.IsInRole("platform-admin") || ctx.User.IsInRole("ext-organization-manage")));
    options.AddPolicy("RequireManagerOrAbove", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("manager") || ctx.User.IsInRole("hr-admin") ||
            ctx.User.IsInRole("tenant-admin") || ctx.User.IsInRole("platform-admin") ||
            ctx.User.IsInRole("ext-team-manage")));
});

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<OrganizationDbContext>();
    db.Database.EnsureCreated();
}

app.UseSwagger();
app.UseSwaggerUI();

app.UseAuthentication();
app.UseTenantContext();
app.UseAuthorization();
app.UseHttpMetrics();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "organization-service" }));

app.MapControllers();
app.MapMetrics();

app.Run();
// DB sifre duzeltmesi sonrasi yeniden deploy - 2026-09-18T10:41:52Z
