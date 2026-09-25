using Prometheus;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using EmployeeService.Data;
using EmployeeService.Tenancy;
using EmployeeService.Messaging;
using EmployeeService.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = Environment.GetEnvironmentVariable("EMPLOYEE_DB_CONNECTION")
    ?? throw new InvalidOperationException("DB connection string not configured");

builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient<OrganizationDirectoryClient>();

builder.Services.AddDbContext<EmployeeDbContext>(options =>
    options.UseNpgsql(connectionString));

var keycloakAuthority = Environment.GetEnvironmentVariable("KEYCLOAK_AUTHORITY")
    ?? "http://172.33.55.2:8080/realms/hr360";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.RequireHttpsMetadata = false;
        options.MetadataAddress = keycloakAuthority + "/.well-known/openid-configuration";
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = true,
            ValidIssuer = keycloakAuthority,
        };
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
                catch (JsonException) { }

                return Task.CompletedTask;
            }
        };
    });

builder.Services.AddAuthorization(options =>
{
    // Bu serviste RequireHrAdmin sadece LinkKeycloakUser'i, RequireManagerOrAbove
    // sadece Create/CreateAssignment'i koruyor - roles.ts'te tek bir izne
    // karsilik geliyorlar (employee:manage, employee:create), o yuzden "ext-*"
    // ek izin rolunu dogrudan policy'ye eklemek dogru.
    options.AddPolicy("RequireHrAdmin", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("hr-admin") || ctx.User.IsInRole("tenant-admin") ||
            ctx.User.IsInRole("platform-admin") || ctx.User.IsInRole("ext-employee-manage")));
    options.AddPolicy("RequireManagerOrAbove", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("manager") || ctx.User.IsInRole("hr-admin") ||
            ctx.User.IsInRole("tenant-admin") || ctx.User.IsInRole("platform-admin") ||
            ctx.User.IsInRole("ext-employee-create")));
});

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
    });
builder.Services.AddHostedService<OutboxPublisher>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<EmployeeDbContext>();
    db.Database.EnsureCreated();
}

app.UseSwagger();
app.UseSwaggerUI();

app.UseAuthentication();
app.UseTenantContext();
app.UseAuthorization();
app.UseHttpMetrics();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "employee-service" }));
app.MapControllers();
app.MapMetrics();

app.Run();
// DB sifre duzeltmesi sonrasi yeniden deploy - 2026-09-18T10:41:52Z
