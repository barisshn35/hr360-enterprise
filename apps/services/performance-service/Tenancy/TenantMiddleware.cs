using System.Security.Claims;

namespace PerformanceService.Tenancy;

/// <summary>
/// JWT'deki organization claim'inden tenant'i cozer ve istek kapsamindaki
/// TenantContext'e yazar. UseAuthentication'DAN SONRA cagrilmalidir.
///
/// Guvenlik notu: Tenant kimligi YALNIZCA token'dan gelir. Istemcinin
/// gonderdigi header/parametre asla dikkate alinmaz - aksi halde bir
/// kullanici baska tenant'in verisini isteyebilirdi.
/// </summary>
public class TenantMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<TenantMiddleware> _logger;

    public TenantMiddleware(RequestDelegate next, ILogger<TenantMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, TenantContext tenantContext)
    {
        var user = context.User;

        if (user?.Identity?.IsAuthenticated == true)
        {
            tenantContext.IsPlatformAdmin = user.IsInRole("platform-admin");

            var raw = user.FindFirst("organization")?.Value;
            if (!string.IsNullOrWhiteSpace(raw))
            {
                // Claim dizi olarak gelebilir: ["acme"] -> acme
                tenantContext.TenantSlug = raw.Trim('[', ']', '"', ' ');
            }

            if (!tenantContext.IsResolved)
            {
                _logger.LogWarning(
                    "Kimlik dogrulandi ama tenant cozulemedi. Kullanici: {User}",
                    user.FindFirst(ClaimTypes.NameIdentifier)?.Value);
            }
        }

        await _next(context);
    }
}

public static class TenantMiddlewareExtensions
{
    public static IApplicationBuilder UseTenantContext(this IApplicationBuilder app)
        => app.UseMiddleware<TenantMiddleware>();
}
