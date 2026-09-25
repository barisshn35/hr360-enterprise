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
// NOT: install.sh'nin urettigi "demo.admin" Keycloak kullanicisinin gercekten
// calisir bir demo tenant'i olmasini saglar - bkz. dosyanin basindaki aciklama.
builder.Services.AddHostedService<DemoTenantSeederHostedService>();

var keycloakAuthority = Environment.GetEnvironmentVariable("KEYCLOAK_AUTHORITY")
    ?? "http://172.33.55.2:8080/realms/hr360";

// GUVENLIK (CTO denetimi): Onceden issuer ve istemci dogrulanmiyordu - realm'deki
// HERHANGI bir istemcinin (orn. admin-cli, servis hesaplari) jetonu kabul ediliyordu.
// Keycloak artik sabit genel adresle calistigi icin issuer tek ve bilinir
// (KEYCLOAK_VALID_ISSUERS, virgulle birden fazla); jetonun hangi istemci icin
// verildigi (azp) de izinli listede olmali (KEYCLOAK_ALLOWED_CLIENTS, varsayilan
// hr360-web). KEYCLOAK_VALID_ISSUERS tanimsizsa eski davranis (issuer kontrolu yok).
var jwtValidIssuers = (Environment.GetEnvironmentVariable("KEYCLOAK_VALID_ISSUERS") ?? "")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
var jwtAllowedClients = (Environment.GetEnvironmentVariable("KEYCLOAK_ALLOWED_CLIENTS") ?? "hr360-web")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.Authority = keycloakAuthority;
        options.RequireHttpsMetadata = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateAudience = false,
            ValidateIssuer = jwtValidIssuers.Length > 0,
            ValidIssuers = jwtValidIssuers,
        };
        options.Events = new JwtBearerEvents
        {
            OnTokenValidated = context =>
            {
                // Izinli istemci (azp) kontrolu - bkz. jwtAllowedClients.
                var azp = context.Principal?.FindFirst("azp")?.Value;
                if (jwtAllowedClients.Length > 0 && (azp is null || !jwtAllowedClients.Contains(azp)))
                {
                    context.Fail("Bu istemci icin verilmis jetonlar kabul edilmiyor");
                    return Task.CompletedTask;
                }

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

// GUVENLIK: Anonim sirket kaydi sinirsizdi - her cagri bir Keycloak
// organizasyonu + kullanicisi olusturup e-posta gonderiyor (e-posta bombardimani,
// Keycloak'i doldurma). IP basina 15 dakikada 5 kayit. Istemci IP'si nginx'in
// her istekte uzerine yazdigi X-Real-IP basligindan alinir.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("registration", httpContext =>
        System.Threading.RateLimiting.RateLimitPartition.GetFixedWindowLimiter(
            httpContext.Request.Headers["X-Real-IP"].FirstOrDefault()
                ?? httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new System.Threading.RateLimiting.FixedWindowRateLimiterOptions
            {
                PermitLimit = 5,
                Window = TimeSpan.FromMinutes(15),
                QueueLimit = 0,
            }));
    options.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.ContentType = "application/json";
        await ctx.HttpContext.Response.WriteAsync(
            "{\"message\":\"Çok fazla kayıt denemesi. Lütfen biraz sonra tekrar deneyin.\"}", ct);
    };
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();

app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseHttpMetrics();

app.MapGet("/health", () => Results.Ok(new { status = "ok", service = "tenant-service" }));
app.MapControllers();
app.MapMetrics();

app.Run();
// keycloak admin env fix dogrulama
// DB sifre duzeltmesi v2 - 2026-09-18T10:46:42Z
