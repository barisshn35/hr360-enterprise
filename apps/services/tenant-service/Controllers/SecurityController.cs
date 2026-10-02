using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;
using TenantService.Services;

namespace TenantService.Controllers;

/// <summary>
/// Şirket güvenlik ayarları: kurumsal SSO (Google Workspace / Microsoft Entra ID,
/// Keycloak "identity brokering" ile) ve iki adımlı doğrulama (TOTP) zorunluluğu.
///
/// SSO NASIL ÇALIŞIR: Sağlayıcı realm'e eklenir ve şirketin Keycloak
/// organizasyonuna bağlanır. Giriş ekranında e-posta alan adı şirketinkiyle
/// eşleşen kullanıcı doğrudan şirketin sağlayıcısına yönlenir; dönüşte Keycloak
/// hesabı e-postayla eşleştirir. Sağlayıcı tarafında (Google Cloud Console /
/// Entra ID "App registrations") yanıttaki redirectUri kayıtlı olmalıdır.
/// </summary>
[ApiController]
[Route("api/security")]
[Authorize(Policy = "RequireTenantAdmin")]
public class SecurityController : ControllerBase
{
    private readonly TenantDbContext _db;
    private readonly KeycloakAdminClient _kc;
    public SecurityController(TenantDbContext db, KeycloakAdminClient kc) { _db = db; _kc = kc; }

    private async Task<(string Slug, string OrgId, string? Domain)?> TenantAsync()
    {
        var slug = TenantService.Security.OrganizationClaimParser.ParseSlug(User.FindFirst("organization")?.Value)?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug)) return null;
        var t = await _db.Tenants.Where(x => x.Slug == slug).Select(x => new { x.Slug, x.KeycloakOrgId, x.EmailDomain }).FirstOrDefaultAsync();
        return t?.KeycloakOrgId is null ? null : (t.Slug, t.KeycloakOrgId, t.EmailDomain);
    }

    private static string PublicOrigin =>
        (Environment.GetEnvironmentVariable("PUBLIC_ORIGIN") ?? Environment.GetEnvironmentVariable("PUBLIC_URL") ?? "http://localhost").TrimEnd('/');

    private static string RedirectUri(string alias) => $"{PublicOrigin}/auth/realms/hr360/broker/{alias}/endpoint";

    [HttpGet("sso")]
    public async Task<IActionResult> GetSso(CancellationToken ct)
    {
        var t = await TenantAsync();
        if (t is null) return NotFound(new { message = "Şirket bulunamadı." });
        var idps = await _kc.ListOrganizationIdentityProvidersAsync(t.Value.OrgId, ct);
        return Ok(new
        {
            domain = t.Value.Domain,
            providers = idps.Select(i => new
            {
                alias = i.GetProperty("alias").GetString(),
                displayName = i.TryGetProperty("displayName", out var d) ? d.GetString() : null,
                providerId = i.TryGetProperty("providerId", out var p) ? p.GetString() : null,
                enabled = i.TryGetProperty("enabled", out var e) && e.GetBoolean(),
                redirectUri = RedirectUri(i.GetProperty("alias").GetString()!),
            }),
            supported = new[]
            {
                new { id = "google", label = "Google Workspace", redirectUri = RedirectUri($"{t.Value.Slug}-google") },
                new { id = "microsoft", label = "Microsoft Entra ID (Azure AD)", redirectUri = RedirectUri($"{t.Value.Slug}-microsoft") },
            },
        });
    }

    public record SsoInput(string Provider, string ClientId, string ClientSecret, string? DirectoryId, string? Domain);

    [HttpPost("sso")]
    public async Task<IActionResult> AddSso(SsoInput body, CancellationToken ct)
    {
        var t = await TenantAsync();
        if (t is null) return NotFound(new { message = "Şirket bulunamadı." });
        if (string.IsNullOrWhiteSpace(body.ClientId) || string.IsNullOrWhiteSpace(body.ClientSecret))
            return BadRequest(new { message = "İstemci kimliği ve gizli anahtar zorunlu." });
        var domain = (body.Domain ?? t.Value.Domain)?.Trim().ToLowerInvariant();
        var alias = $"{t.Value.Slug}-{body.Provider}";
        var config = new Dictionary<string, string>
        {
            ["clientId"] = body.ClientId.Trim(), ["clientSecret"] = body.ClientSecret.Trim(), ["syncMode"] = "IMPORT",
            ["guiOrder"] = "1",
        };
        if (!string.IsNullOrEmpty(domain))
        {
            config["kc.org.domain"] = domain;
            config["kc.org.broker.redirect.mode.email-matches"] = "true";
        }
        string providerId, display;
        switch (body.Provider)
        {
            case "google":
                providerId = "google"; display = "Google ile giriş";
                if (!string.IsNullOrEmpty(domain)) config["hostedDomain"] = domain;
                config["defaultScope"] = "openid profile email";
                break;
            case "microsoft":
                if (string.IsNullOrWhiteSpace(body.DirectoryId) || !Guid.TryParse(body.DirectoryId, out _))
                    return BadRequest(new { message = "Microsoft için Dizin (kiracı) kimliği GUID olarak girilmeli." });
                providerId = "oidc"; display = "Microsoft ile giriş";
                var b = $"https://login.microsoftonline.com/{body.DirectoryId!.Trim()}";
                config["authorizationUrl"] = $"{b}/oauth2/v2.0/authorize";
                config["tokenUrl"] = $"{b}/oauth2/v2.0/token";
                config["logoutUrl"] = $"{b}/oauth2/v2.0/logout";
                config["issuer"] = $"{b}/v2.0";
                config["jwksUrl"] = $"{b}/discovery/v2.0/keys";
                config["useJwksUrl"] = "true";
                config["validateSignature"] = "true";
                config["clientAuthMethod"] = "client_secret_post";
                config["defaultScope"] = "openid profile email";
                config["pkceEnabled"] = "true";
                config["pkceMethod"] = "S256";
                break;
            default:
                return BadRequest(new { message = "Sağlayıcı google veya microsoft olmalı." });
        }
        try
        {
            await _kc.CreateOrganizationIdentityProviderAsync(t.Value.OrgId, alias, display, providerId, config, ct);
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(502, new { message = ex.Message });
        }
        return Ok(new { alias, redirectUri = RedirectUri(alias) });
    }

    [HttpDelete("sso/{alias}")]
    public async Task<IActionResult> RemoveSso(string alias, CancellationToken ct)
    {
        var t = await TenantAsync();
        if (t is null) return NotFound();
        if (!alias.StartsWith(t.Value.Slug + "-", StringComparison.Ordinal)) return Forbid();
        await _kc.DeleteIdentityProviderAsync(t.Value.OrgId, alias, ct);
        return NoContent();
    }

    [HttpGet("mfa")]
    public async Task<IActionResult> GetMfa(CancellationToken ct)
    {
        var t = await TenantAsync();
        if (t is null) return NotFound();
        var ids = await _kc.ListOrganizationMemberIdsAsync(t.Value.OrgId, ct);
        var rows = new List<object>();
        int withOtp = 0, pending = 0;
        foreach (var id in ids.Take(500))
        {
            var (has, pend, username) = await _kc.GetOtpStatusAsync(id, ct);
            if (has) withOtp++;
            else if (pend) pending++;
            rows.Add(new { userId = id, username, hasOtp = has, pendingSetup = pend && !has });
        }
        return Ok(new { members = ids.Count, withOtp, pendingSetup = pending, without = ids.Count - withOtp - pending, users = rows });
    }

    /// <summary>OTP'si olmayan tüm şirket kullanıcılarına bir sonraki girişte kurulum zorunluluğu ekler.</summary>
    [HttpPost("mfa/enforce")]
    public async Task<IActionResult> EnforceMfa(CancellationToken ct)
    {
        var t = await TenantAsync();
        if (t is null) return NotFound();
        var ids = await _kc.ListOrganizationMemberIdsAsync(t.Value.OrgId, ct);
        var changed = 0;
        foreach (var id in ids)
        {
            var (has, pend, _) = await _kc.GetOtpStatusAsync(id, ct);
            if (has || pend) continue;
            await _kc.RequireOtpSetupAsync(id, ct);
            changed++;
        }
        return Ok(new { required = changed, members = ids.Count });
    }
}
