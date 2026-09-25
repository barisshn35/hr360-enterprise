using Prometheus;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using TenantService.Data;
using TenantService.Services;

var builder = WebApplication.CreateBuilder(args);

var connectionString = Environment.GetEnvironmentVariable("TENANT_DB_CONNECTION")
    ?? throw new InvalidOperationException("DB connection string not configured");

builder.Services.AddDbContext<TenantDbContext>(options =>
    options.UseNpgsql(connectionString));

builder.Services.AddHttpClient<KeycloakAdminClient>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient<EmployeeDirectoryClient>();
builder.Services.AddScoped<TenantProvisioningService>();
builder.Services.AddSingleton<TenantService.Security.SmtpCredentialProtector>();
builder.Services.AddSingleton<TenantService.Services.LogoStorageService>();

var keycloakAuthority = Environment.GetEnvironmentVariable("KEYCLOAK_AUTHORITY")
    ?? "http://172.33.55.2:8080/realms/hr360";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = false,
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                var identity = context.Principal?.Identity as ClaimsIdentity;
                if (identity is null) return Task.CompletedTask;

                var realmAccess = identity.FindFirst("realm_access")?.Value;
                if (string.IsNullOrEmpty(realmAccess)) return Task.CompletedTask;

                try
                {
                    using var doc = JsonDocument.Parse(realmAccess);
                    if (doc.RootElement.TryGetProperty("roles", out var roles))
                    {
                        foreach (var role in roles.EnumerateArray())
                        {
                            var name = role.GetString();
                            if (!string.IsNullOrEmpty(name))
                                identity.AddClaim(new Claim(ClaimTypes.Role, name));
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
    options.AddPolicy("RequirePlatformAdmin", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("platform-admin") || ctx.User.IsInRole("ext-platform-manage")));
    // GUVENLIK: "RequireTenantAdmin" MyTenantController'da (tenant:manage
    // izni) genisletiliyor - ama TeamMembersController.AssignExtraPermission/
    // RemoveExtraPermission (Ek izin atama/kaldirma) AYNI policy adini
    // kullanirsa, "tenant:manage" ek iznini alan biri baskalarina da izin
    // atayabilir hale gelirdi - bu, "sadece Sirket/Platform Yoneticisi ek
    // izin atayabilir" tasarim kuralini deler. Bu yuzden ek izin uclari,
    // "ext-*" genislemesi OLMAYAN bu ayri policy'yi kullaniyor.
    options.AddPolicy("RequireTenantAdminOnly", policy =>
        policy.RequireRole("tenant-admin", "platform-admin"));
    options.AddPolicy("RequireTenantAdmin", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("tenant-admin") || ctx.User.IsInRole("platform-admin") ||
            ctx.User.IsInRole("ext-tenant-manage")));
    options.AddPolicy("RequireHrAdmin", policy =>
        policy.RequireRole("hr-admin", "tenant-admin", "platform-admin"));
    options.AddPolicy("RequireManagerOrAbove", policy =>
        policy.RequireRole("manager", "hr-admin", "tenant-admin", "platform-admin"));
});

builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.ReferenceHandler =
            System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseAuthentication();
app.UseAuthorization();
app.UseHttpMetrics();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "tenant-service" }));
app.MapControllers();
app.MapMetrics();

app.Run();
// keycloak admin env fix dogrulama
// DB sifre duzeltmesi v2 - 2026-09-18T10:46:42Z
