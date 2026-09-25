using Prometheus;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using OnboardingService.Data;
using OnboardingService.Tenancy;

var builder = WebApplication.CreateBuilder(args);

var connectionString = Environment.GetEnvironmentVariable("ONBOARDING_DB_CONNECTION")
    ?? throw new InvalidOperationException("DB connection string not configured");

builder.Services.AddScoped<TenantContext>();
builder.Services.AddScoped<ITenantContext>(sp => sp.GetRequiredService<TenantContext>());

builder.Services.AddDbContext<OnboardingDbContext>(options =>
    options.UseNpgsql(connectionString));

var keycloakAuthority = Environment.GetEnvironmentVariable("KEYCLOAK_AUTHORITY")
    ?? "http://172.33.55.2:8080/realms/hr360";

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.RequireHttpsMetadata = false; // ic ag, VPN arkasinda
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            // Token app-01 veya app-02'deki Keycloak'tan alinabilir; iki instance
            // farkli issuer URL'i dondugu icin issuer dogrulamasi kapali.
            ValidateIssuer = false,
        };
        // Keycloak realm_access.roles claim'ini ASP.NET Core'un ClaimTypes.Role'une
        // esler. Bu olmadan policy/role tabanli yetkilendirme calismaz.
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
    options.AddPolicy("RequireHrAdmin", policy =>
        policy.RequireRole("hr-admin", "tenant-admin", "platform-admin"));
    options.AddPolicy("RequireManagerOrAbove", policy =>
        policy.RequireRole("manager", "hr-admin", "tenant-admin", "platform-admin"));
    // AssetsController'in tum uclari roles.ts'te tek bir ize karsilik
    // geliyor (asset:manage); OnboardingPlansController'daki hem RequireHrAdmin
    // hem RequireManagerOrAbove uclari da tek bir ize karsilik geliyor
    // (onboarding:manage, manager seviyesinde tanimli). Bu yuzden
    // RequireHrAdmin/RequireManagerOrAbove'u dogrudan genisletmek yerine
    // (baska iznin uclarina da acar), controller'lara ozel yeni policy'ler.
    options.AddPolicy("RequireAssetManage", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("hr-admin") || ctx.User.IsInRole("tenant-admin") ||
            ctx.User.IsInRole("platform-admin") || ctx.User.IsInRole("ext-asset-manage")));
    options.AddPolicy("RequireOnboardingManage", policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole("manager") || ctx.User.IsInRole("hr-admin") ||
            ctx.User.IsInRole("tenant-admin") || ctx.User.IsInRole("platform-admin") ||
            ctx.User.IsInRole("ext-onboarding-manage")));
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
app.UseTenantContext();
app.UseAuthorization();
app.UseHttpMetrics();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "onboarding-service" }));
app.MapControllers();
app.MapMetrics();

app.Run();
// DB sifre duzeltmesi v2 - 2026-09-18T10:46:42Z
