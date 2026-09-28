using System.Collections.Concurrent;
using Npgsql;

namespace ExpenseService.Tenancy;

/// <summary>
/// GUVENLIK (CTO denetimi): Askiya alinan bir kiracinin kullanicilari Keycloak'ta
/// kapatiliyor ve oturumlari sonlandiriliyor; ancak ellerindeki erisim jetonu omru
/// dolana kadar (varsayilan 5 dk) API'lerde gecerli kaliyordu. Bu kapi her kimligi
/// dogrulanmis istekte kiracinin durumunu (platform_tenants, 30 sn onbellek) kontrol
/// eder; askidaysa 403 doner. Platform yoneticisi etkilenmez.
///
/// Baglanti: TENANT_STATUS_DB_CONNECTION (tanimsizsa kapi devre disi). Veritabani
/// gecici olarak okunamazsa istek gecirilir (kesinti yerine kisa sureli izin) ve
/// uyari yazilir.
/// </summary>
public class TenantStatusGate
{
    private static readonly ConcurrentDictionary<string, (bool Suspended, DateTime At)> Cache = new();
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);
    private static readonly string? ConnectionString =
        Environment.GetEnvironmentVariable("TENANT_STATUS_DB_CONNECTION");

    private readonly RequestDelegate _next;
    private readonly ILogger<TenantStatusGate> _logger;

    public TenantStatusGate(RequestDelegate next, ILogger<TenantStatusGate> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context, TenantContext tenant)
    {
        if (!string.IsNullOrEmpty(ConnectionString)
            && context.User?.Identity?.IsAuthenticated == true
            && !tenant.IsPlatformAdmin
            && !string.IsNullOrWhiteSpace(tenant.TenantSlug)
            && await IsSuspendedAsync(tenant.TenantSlug!, context.RequestAborted))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await context.Response.WriteAsJsonAsync(new
            {
                message = "Şirket hesabı askıya alınmış. Lütfen yöneticinizle iletişime geçin.",
                code = "tenant_suspended",
            });
            return;
        }
        await _next(context);
    }

    private async Task<bool> IsSuspendedAsync(string slug, CancellationToken ct)
    {
        if (Cache.TryGetValue(slug, out var hit) && DateTime.UtcNow - hit.At < Ttl)
            return hit.Suspended;
        try
        {
            await using var conn = new NpgsqlConnection(ConnectionString);
            await conn.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "SELECT \"Status\" FROM platform_tenants WHERE \"Slug\" = @s LIMIT 1", conn);
            cmd.Parameters.AddWithValue("s", slug);
            var status = await cmd.ExecuteScalarAsync(ct) as string;
            var suspended = string.Equals(status, "Suspended", StringComparison.OrdinalIgnoreCase);
            Cache[slug] = (suspended, DateTime.UtcNow);
            return suspended;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Kiraci durumu okunamadi ({Slug}); istek geciriliyor", slug);
            return hit.At != default && hit.Suspended;
        }
    }
}
