using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;
using GovernanceService.Infrastructure.Chat;
using GovernanceService.Models;
using GovernanceService.Tenancy;

namespace GovernanceService.Controllers;

/* ======================================================================
 * Sohbet uygulamaları (Slack uygulaması / Microsoft Teams botu) yönetimi.
 * Gelen webhook'tan (IntegrationsController) farkı: kişiye özel mesaj,
 * "Onayla / Reddet" düğmeleri, komutlar ve talep sahibine sonuç bildirimi.
 * ==================================================================== */
[Route("api/chat-apps")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class ChatAppsController : AppController
{
    private readonly GovernanceDbContext _db;
    private readonly SlackApi _slack;
    private readonly TeamsApi _teams;
    private readonly ChatService _chat;

    public ChatAppsController(GovernanceDbContext db, SlackApi slack, TeamsApi teams, ChatService chat)
    { _db = db; _slack = slack; _teams = teams; _chat = chat; }

    public static object Endpoints(ChatApp a) => a.Platform == "Slack"
        ? new
        {
            commands = $"{ChatService.PublicOrigin}/api/governance/chat/slack/{a.Id}/commands",
            interactivity = $"{ChatService.PublicOrigin}/api/governance/chat/slack/{a.Id}/interactions",
            events = $"{ChatService.PublicOrigin}/api/governance/chat/slack/{a.Id}/events",
        }
        : (object)new { messaging = $"{ChatService.PublicOrigin}/api/governance/chat/teams/{a.Id}/messages" };

    private object View(ChatApp a, int linked, int total) => new
    {
        a.Id, a.Platform, a.Name, a.IsEnabled, a.NotifyApprovals, a.NotifyRequesters,
        a.SlackTeamId, a.SlackTeamName, a.TeamsAppId, a.TeamsAzureTenantId,
        hasSlackToken = a.SlackBotTokenEnc != null, hasSigningSecret = a.SlackSigningSecretEnc != null, hasTeamsPassword = a.TeamsAppPasswordEnc != null,
        a.LastError, a.LastActivityAt, a.CreatedAt, linkedUsers = linked, knownUsers = total,
        endpoints = Endpoints(a),
        publicOriginIsHttps = ChatService.PublicOrigin.StartsWith("https://", StringComparison.OrdinalIgnoreCase),
    };

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var apps = await _db.ChatApps.AsNoTracking().OrderBy(a => a.Platform).ThenBy(a => a.Name).ToListAsync(ct);
        var counts = await _db.ChatIdentities.AsNoTracking().GroupBy(i => i.AppId)
            .Select(g => new { g.Key, Linked = g.Count(i => i.EmployeeId != null), Total = g.Count() }).ToListAsync(ct);
        return Ok(apps.Select(a =>
        {
            var c = counts.FirstOrDefault(x => x.Key == a.Id);
            return View(a, c?.Linked ?? 0, c?.Total ?? 0);
        }));
    }

    public record ChatAppInput(string Platform, string Name, bool IsEnabled, bool NotifyApprovals, bool NotifyRequesters,
        string? SlackBotToken, string? SlackSigningSecret, string? TeamsAppId, string? TeamsAppPassword, string? TeamsAzureTenantId);

    private async Task<string?> ApplyAsync(ChatApp a, ChatAppInput body, bool creating, CancellationToken ct)
    {
        if (body.IsEnabled && await TransferGuard.MissingAsync(_db, Tenant, TransferGuard.KeyOf(a.Platform), ct) is { } transferError)
            return transferError;
        a.Name = string.IsNullOrWhiteSpace(body.Name) ? a.Platform : body.Name.Trim();
        a.IsEnabled = body.IsEnabled;
        a.NotifyApprovals = body.NotifyApprovals;
        a.NotifyRequesters = body.NotifyRequesters;
        if (a.Platform == "Slack")
        {
            var token = string.IsNullOrWhiteSpace(body.SlackBotToken) ? SecretBox.Unprotect(a.SlackBotTokenEnc) : body.SlackBotToken.Trim();
            if (string.IsNullOrEmpty(token) || !token.StartsWith("xoxb-")) return "Bot jetonu \"xoxb-\" ile başlamalı (Slack uygulaması › OAuth & Permissions › Bot User OAuth Token).";
            if (creating && string.IsNullOrWhiteSpace(body.SlackSigningSecret)) return "İmzalama anahtarı (Basic Information › Signing Secret) zorunlu.";
            try
            {
                var (teamId, team, botUser) = await _slack.AuthTestAsync(token, ct);
                a.SlackTeamId = teamId; a.SlackTeamName = team; a.SlackBotUserId = botUser;
            }
            catch (ChatApiException ex) { return $"Slack jetonu doğrulanamadı: {ex.Message}"; }
            catch (HttpRequestException ex) { return $"Slack'e ulaşılamadı: {ex.Message}"; }
            if (!string.IsNullOrWhiteSpace(body.SlackBotToken)) a.SlackBotTokenEnc = SecretBox.Protect(token);
            if (!string.IsNullOrWhiteSpace(body.SlackSigningSecret)) a.SlackSigningSecretEnc = SecretBox.Protect(body.SlackSigningSecret.Trim());
        }
        else
        {
            if (!Guid.TryParse(body.TeamsAppId, out _)) return "Microsoft App ID bir GUID olmalı (Azure Bot › Configuration).";
            if (!Guid.TryParse(body.TeamsAzureTenantId, out _)) return "Dizin (kiracı) kimliği bir GUID olmalı (Entra ID › Overview › Tenant ID).";
            var password = string.IsNullOrWhiteSpace(body.TeamsAppPassword) ? SecretBox.Unprotect(a.TeamsAppPasswordEnc) : body.TeamsAppPassword.Trim();
            if (string.IsNullOrEmpty(password)) return "İstemci gizli anahtarı (client secret) zorunlu.";
            try { await _teams.TokenAsync(body.TeamsAppId!.Trim(), password, body.TeamsAzureTenantId!.Trim(), ct); }
            catch (ChatApiException ex) { return ex.Message; }
            catch (HttpRequestException ex) { return $"Microsoft oturum açma hizmetine ulaşılamadı: {ex.Message}"; }
            a.TeamsAppId = body.TeamsAppId!.Trim();
            a.TeamsAzureTenantId = body.TeamsAzureTenantId!.Trim();
            if (!string.IsNullOrWhiteSpace(body.TeamsAppPassword)) a.TeamsAppPasswordEnc = SecretBox.Protect(password);
        }
        a.LastError = null;
        return null;
    }

    [HttpPost]
    public async Task<IActionResult> Create(ChatAppInput body, CancellationToken ct)
    {
        if (body.Platform is not ("Slack" or "Teams")) return BadRequest(new { message = "Platform Slack ya da Teams olmalı." });
        var a = new ChatApp { Platform = body.Platform };
        var error = await ApplyAsync(a, body, creating: true, ct);
        if (error is not null) return BadRequest(new { message = error });
        _db.ChatApps.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(View(a, 0, 0));
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, ChatAppInput body, CancellationToken ct)
    {
        var a = await _db.ChatApps.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        var error = await ApplyAsync(a, body with { Platform = a.Platform }, creating: false, ct);
        if (error is not null) return BadRequest(new { message = error });
        await _db.SaveChangesAsync(ct);
        return Ok(View(a, 0, 0));
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var a = await _db.ChatApps.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        _db.ChatApps.Remove(a);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpGet("{id:guid}/identities")]
    public async Task<IActionResult> Identities(Guid id, CancellationToken ct)
    {
        var rows = await _db.ChatIdentities.AsNoTracking().Where(i => i.AppId == id).OrderByDescending(i => i.LastSeenAt).Take(500).ToListAsync(ct);
        var names = (await People.ListAsync(Tenant, ct)).ToDictionary(p => p.Id, p => p.Name);
        return Ok(rows.Select(i => new
        {
            i.Id, i.ExternalUserId, i.Email, i.DisplayName, i.EmployeeId,
            employeeName = i.EmployeeId is { } e && names.TryGetValue(e, out var n) ? n : null,
            canReceive = i.ConversationId != null, i.LinkedAt, i.LastSeenAt,
        }));
    }

    /// <summary>Oturumdaki kullanıcıya deneme mesajı gönderir.</summary>
    [HttpPost("{id:guid}/test")]
    public async Task<IActionResult> Test(Guid id, CancellationToken ct)
    {
        var a = await _db.ChatApps.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null) return NotFound();
        var me = await MyPersonAsync(ct);
        if (me is null) return BadRequest(new { message = "Hesabınıza bağlı çalışan kaydı yok; deneme mesajı gönderilemez." });
        bool sent;
        try { sent = await _chat.SendTextToEmployeeAsync(_db, a, me.Id, $"👋 Merhaba {me.Name.Split(' ')[0]}! HR360 bu hesaba bildirim gönderebiliyor.\n{ChatService.Help}", ChatService.PublicOrigin + "/panel", ct); }
        catch (Exception ex) when (ex is ChatApiException or HttpRequestException)
        {
            a.LastError = ex.Message;
            await _db.SaveChangesAsync(ct);
            return BadRequest(new { message = ex.Message });
        }
        await _db.SaveChangesAsync(ct);
        if (sent) return Ok(new { sent = true });
        return BadRequest(new
        {
            message = a.Platform == "Slack"
                ? $"Slack'te {me.Email} e-postalı bir kullanıcı bulunamadı. Slack hesabınızın e-postası HR360'takiyle aynı olmalı."
                : "Teams'te botu henüz eklemediniz. Teams › Uygulamalar'dan HR360'ı ekleyip bir kez \"merhaba\" yazın; sonra tekrar deneyin.",
        });
    }

    /// <summary>Slack'te "Create New App › From an app manifest" için hazır manifest.</summary>
    [HttpGet("{id:guid}/slack-manifest")]
    public async Task<IActionResult> SlackManifest(Guid id, CancellationToken ct)
    {
        var a = await _db.ChatApps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Platform == "Slack", ct);
        return a is null ? NotFound() : Ok(BuildSlackManifest(a.Name, a.Id));
    }

    /// <summary>Uygulama oluşturulmadan önce manifest (henüz kimlik yokken). URL'ler sonradan güncellenir.</summary>
    [HttpGet("slack-manifest")]
    public IActionResult SlackManifestDraft([FromQuery] string? name) => Ok(BuildSlackManifest(name ?? "HR360", null));

    private static JsonObject BuildSlackManifest(string name, Guid? id)
    {
        var baseUrl = $"{ChatService.PublicOrigin}/api/governance/chat/slack/{(id is null ? "<UYGULAMA-KIMLIGI>" : id.ToString())}";
        return new JsonObject
        {
            ["display_information"] = new JsonObject
            {
                ["name"] = name.Length > 35 ? name[..35] : name,
                ["description"] = "İzin, masraf ve onay talepleri; bakiye ve ekip durumu.",
                ["background_color"] = "#0f766e",
            },
            ["features"] = new JsonObject
            {
                ["app_home"] = new JsonObject { ["home_tab_enabled"] = false, ["messages_tab_enabled"] = true, ["messages_tab_read_only_enabled"] = false },
                ["bot_user"] = new JsonObject { ["display_name"] = "HR360", ["always_online"] = true },
                ["slash_commands"] = new JsonArray
                {
                    new JsonObject { ["command"] = "/hr360", ["url"] = $"{baseUrl}/commands", ["description"] = "HR360 komutları", ["usage_hint"] = "onaylarım | bakiye | izindekiler | kimnerede", ["should_escape"] = false },
                },
            },
            ["oauth_config"] = new JsonObject
            {
                ["scopes"] = new JsonObject { ["bot"] = new JsonArray("chat:write", "commands", "im:write", "im:history", "users:read", "users:read.email") },
            },
            ["settings"] = new JsonObject
            {
                ["event_subscriptions"] = new JsonObject { ["request_url"] = $"{baseUrl}/events", ["bot_events"] = new JsonArray("message.im") },
                ["interactivity"] = new JsonObject { ["is_enabled"] = true, ["request_url"] = $"{baseUrl}/interactions" },
                ["org_deploy_enabled"] = false, ["socket_mode_enabled"] = false, ["token_rotation_enabled"] = false,
            },
        };
    }

    /// <summary>Teams'e yüklenecek uygulama paketi (manifest.json + simgeler).</summary>
    [HttpGet("{id:guid}/teams-package")]
    public async Task<IActionResult> TeamsPackage(Guid id, CancellationToken ct)
    {
        var a = await _db.ChatApps.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.Platform == "Teams", ct);
        if (a is null) return NotFound();
        var host = new Uri(ChatService.PublicOrigin).Host;
        var manifest = new JsonObject
        {
            ["$schema"] = "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
            ["manifestVersion"] = "1.17",
            ["version"] = "1.0.0",
            ["id"] = a.TeamsAppId,
            ["developer"] = new JsonObject
            {
                ["name"] = "HR360", ["websiteUrl"] = ChatService.PublicOrigin, ["privacyUrl"] = ChatService.PublicOrigin, ["termsOfUseUrl"] = ChatService.PublicOrigin,
            },
            ["name"] = new JsonObject { ["short"] = a.Name.Length > 30 ? a.Name[..30] : a.Name, ["full"] = "HR360 İnsan Kaynakları" },
            ["description"] = new JsonObject
            {
                ["short"] = "Onay talepleri ve İK bilgileri",
                ["full"] = "İzin, masraf ve diğer onay taleplerini Teams'ten onaylayın; izin bakiyenizi ve bugün kimlerin izinde olduğunu görün.",
            },
            ["icons"] = new JsonObject { ["color"] = "color.png", ["outline"] = "outline.png" },
            ["accentColor"] = "#0F766E",
            ["bots"] = new JsonArray
            {
                new JsonObject
                {
                    ["botId"] = a.TeamsAppId, ["scopes"] = new JsonArray("personal"), ["supportsFiles"] = false, ["isNotificationOnly"] = false,
                    ["commandLists"] = new JsonArray
                    {
                        new JsonObject
                        {
                            ["scopes"] = new JsonArray("personal"),
                            ["commands"] = new JsonArray(
                                new JsonObject { ["title"] = "onaylarım", ["description"] = "Karar bekleyen talepleriniz" },
                                new JsonObject { ["title"] = "bakiye", ["description"] = "İzin bakiyeniz" },
                                new JsonObject { ["title"] = "izindekiler", ["description"] = "Bugün izinde olanlar" },
                                new JsonObject { ["title"] = "kimnerede", ["description"] = "Bugün kim nerede çalışıyor" },
                                new JsonObject { ["title"] = "ben", ["description"] = "Hesap eşleşmesi" }),
                        },
                    },
                },
            },
            ["permissions"] = new JsonArray("identity", "messageTeamMembers"),
            ["validDomains"] = new JsonArray(host),
        };
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Add(string name, byte[] data) { using var s = zip.CreateEntry(name).Open(); s.Write(data); }
            Add("manifest.json", Encoding.UTF8.GetBytes(manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true })));
            Add("color.png", Png.Icon(192, color: true));
            Add("outline.png", Png.Icon(32, color: false));
        }
        return File(ms.ToArray(), "application/zip", "hr360-teams.zip");
    }
}

/* ======================================================================
 * Slack'ten gelen istekler (komut, düğme, DM). Kimlik doğrulama: Slack imzası.
 * ==================================================================== */
[ApiController]
[Route("api/chat/slack/{appId:guid}")]
[AllowAnonymous]
[BufferBody]
public class SlackEndpointsController : ControllerBase
{
    private readonly GovernanceDbContext _db;
    private readonly ChatService _chat;
    private readonly SlackApi _slack;
    private readonly TenantContext _tenant;
    private readonly IServiceScopeFactory _scopes;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<SlackEndpointsController> _log;

    public SlackEndpointsController(GovernanceDbContext db, ChatService chat, SlackApi slack, TenantContext tenant, IServiceScopeFactory scopes,
        IHttpClientFactory http, ILogger<SlackEndpointsController> log)
    { _db = db; _chat = chat; _slack = slack; _tenant = tenant; _scopes = scopes; _http = http; _log = log; }

    /// <summary>Uygulamayı bulur ve Slack imzasını doğrular. Ham gövdeyi döndürür.</summary>
    private async Task<(ChatApp? App, string Raw)> AuthenticateAsync(Guid appId, CancellationToken ct)
    {
        // Gövde [BufferBody] ile model bağlamadan önce tamponlandı; MVC form okuyucusu
        // onu tüketmiş olabilir, imza için baştan okunur.
        Request.Body.Position = 0;
        string raw;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, false, 4096, leaveOpen: true)) raw = await reader.ReadToEndAsync(ct);
        Request.Body.Position = 0;
        var app = await _db.ChatApps.IgnoreQueryFilters().FirstOrDefaultAsync(a => a.Id == appId && a.Platform == "Slack" && a.IsEnabled, ct);
        if (app is null) return (null, raw);
        var secret = SecretBox.Unprotect(app.SlackSigningSecretEnc);
        if (secret is null || !SlackApi.VerifySignature(secret, Request.Headers["X-Slack-Request-Timestamp"].ToString(),
                Request.Headers["X-Slack-Signature"].ToString(), raw))
            return (null, raw);
        // KVKK m.9: dayanak kaydı kaldırıldıysa uygulama veri alışverişi yapmaz.
        if (await TransferGuard.MissingAsync(_db, app.TenantSlug, "slack", ct) is not null) return (null, raw);
        _tenant.TenantSlug = app.TenantSlug;
        return (app, raw);
    }

    private static string? FormValue(string raw, string key) =>
        Microsoft.AspNetCore.WebUtilities.QueryHelpers.ParseQuery(raw).TryGetValue(key, out var v) ? v.ToString() : null;

    [HttpPost("commands")]
    public async Task<IActionResult> Command(Guid appId, CancellationToken ct)
    {
        var (app, raw) = await AuthenticateAsync(appId, ct);
        if (app is null) return Unauthorized();
        var userId = FormValue(raw, "user_id");
        if (string.IsNullOrEmpty(userId)) return BadRequest();
        ChatReply reply;
        try
        {
            var who = await _chat.EnsureSlackIdentityAsync(_db, app, userId, ct);
            reply = await _chat.CommandAsync(who, FormValue(raw, "text"), ct);
        }
        catch (ChatApiException ex)
        {
            _log.LogWarning("Slack komutu: {Message}", ex.Message);
            reply = new ChatReply($"Slack hesabınız okunamadı ({ex.Message}). Uygulamanın users:read.email iznini kontrol edin.", Array.Empty<PendingApproval>());
        }
        return Ok(new { response_type = "ephemeral", text = reply.Text, blocks = ChatFormat.SlackReply(reply) });
    }

    [HttpPost("interactions")]
    public async Task<IActionResult> Interaction(Guid appId, CancellationToken ct)
    {
        var (app, raw) = await AuthenticateAsync(appId, ct);
        if (app is null) return Unauthorized();
        JsonElement payload;
        try { payload = JsonDocument.Parse(FormValue(raw, "payload") ?? "").RootElement.Clone(); }
        catch (JsonException) { return BadRequest(); }
        if (payload.GetProperty("type").GetString() != "block_actions") return Ok();
        var action = payload.GetProperty("actions")[0];
        var actionId = action.GetProperty("action_id").GetString();
        if (actionId is not (ChatFormat.ApproveAction or ChatFormat.RejectAction)) return Ok();
        var parts = (action.GetProperty("value").GetString() ?? "").Split('|');
        if (parts.Length != 2 || !Guid.TryParse(parts[0], out var wfId) || !Guid.TryParse(parts[1], out var stepId)) return BadRequest();
        var userId = payload.GetProperty("user").GetProperty("id").GetString()!;
        var responseUrl = payload.TryGetProperty("response_url", out var ru) ? ru.GetString() : null;
        var approve = actionId == ChatFormat.ApproveAction;
        var tenant = app.TenantSlug;
        var appKey = app.Id;

        // Slack 3 sn içinde yanıt bekler: karar arka planda verilir, sonuç mesaja yazılır.
        _ = Task.Run(async () =>
        {
            using var scope = _scopes.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().TenantSlug = tenant;
            var db = scope.ServiceProvider.GetRequiredService<GovernanceDbContext>();
            var chat = scope.ServiceProvider.GetRequiredService<ChatService>();
            var bg = CancellationToken.None;
            try
            {
                var a = await db.ChatApps.FirstAsync(x => x.Id == appKey, bg);
                var who = await chat.EnsureSlackIdentityAsync(db, a, userId, bg);
                var tracked = await db.ChatMessages.AnyAsync(m => m.AppId == a.Id && m.StepId == stepId && m.State == "Open", bg);
                var result = await chat.DecideAsync(db, a, who, wfId, stepId, approve, bg);
                if (responseUrl is null) return;
                if (result.Ok && !tracked)
                {
                    // Komut yanıtındaki (kayıtlı olmayan) kart: sonuçla değiştirilir.
                    await RespondAsync(responseUrl, new { replace_original = true, text = result.Message,
                        blocks = ChatFormat.SlackText($"{(approve ? "✅" : "⛔")} {result.Message}", ChatService.WorkflowUrl(wfId)) }, bg);
                }
                else if (!result.Ok)
                    await RespondAsync(responseUrl, new { response_type = "ephemeral", replace_original = false, text = "⚠️ " + result.Message }, bg);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Slack kararı işlenemedi");
                if (responseUrl is not null)
                    try { await RespondAsync(responseUrl, new { response_type = "ephemeral", replace_original = false, text = "⚠️ Karar işlenemedi; HR360 üzerinden deneyin." }, bg); } catch { }
            }
        });
        return Ok();
    }

    private async Task RespondAsync(string responseUrl, object body, CancellationToken ct)
    {
        // response_url yalnızca Slack'e gidebilir (SSRF'e karşı); testlerde SLACK_API_BASE ana bilgisayarı da kabul edilir.
        var u = new Uri(responseUrl);
        var testHost = Environment.GetEnvironmentVariable("SLACK_API_BASE") is { Length: > 0 } b ? new Uri(b).Host : null;
        if (!(u.Scheme == "https" && (u.Host == "hooks.slack.com" || u.Host.EndsWith(".slack.com"))) && u.Host != testHost) return;
        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);
        await client.PostAsJsonAsync(responseUrl, body, ct);
    }

    /// <summary>Events API: URL doğrulaması ve bota DM ile yazılan komutlar (message.im).</summary>
    [HttpPost("events")]
    public async Task<IActionResult> Events(Guid appId, CancellationToken ct)
    {
        var (app, raw) = await AuthenticateAsync(appId, ct);
        if (app is null) return Unauthorized();
        var root = JsonDocument.Parse(raw).RootElement;
        var type = root.GetProperty("type").GetString();
        if (type == "url_verification") return Ok(new { challenge = root.GetProperty("challenge").GetString() });
        if (type != "event_callback" || Request.Headers.ContainsKey("X-Slack-Retry-Num")) return Ok();
        var ev = root.GetProperty("event");
        if (ev.GetProperty("type").GetString() != "message" || ev.TryGetProperty("bot_id", out _) || ev.TryGetProperty("subtype", out _)) return Ok();
        if (!ev.TryGetProperty("channel_type", out var ctp) || ctp.GetString() != "im") return Ok();
        var user = ev.GetProperty("user").GetString()!;
        var channel = ev.GetProperty("channel").GetString()!;
        var text = ev.TryGetProperty("text", out var t) ? t.GetString() : null;
        var tenant = app.TenantSlug;
        var appKey = app.Id;
        _ = Task.Run(async () =>
        {
            using var scope = _scopes.CreateScope();
            scope.ServiceProvider.GetRequiredService<TenantContext>().TenantSlug = tenant;
            var db = scope.ServiceProvider.GetRequiredService<GovernanceDbContext>();
            var chat = scope.ServiceProvider.GetRequiredService<ChatService>();
            var slack = scope.ServiceProvider.GetRequiredService<SlackApi>();
            try
            {
                var a = await db.ChatApps.FirstAsync(x => x.Id == appKey);
                var who = await chat.EnsureSlackIdentityAsync(db, a, user, CancellationToken.None);
                who.ConversationId ??= channel;
                await db.SaveChangesAsync();
                var reply = await chat.CommandAsync(who, text, CancellationToken.None);
                await slack.PostAsync(SecretBox.Unprotect(a.SlackBotTokenEnc)!, channel, reply.Text, ChatFormat.SlackReply(reply), CancellationToken.None);
            }
            catch (Exception ex) { _log.LogWarning(ex, "Slack DM komutu işlenemedi"); }
        });
        return Ok();
    }
}

/* ======================================================================
 * Microsoft Teams (Bot Framework) mesaj ucu. Kimlik doğrulama: Bot Framework JWT.
 * ==================================================================== */
[ApiController]
[Route("api/chat/teams/{appId:guid}/messages")]
[AllowAnonymous]
public class TeamsEndpointsController : ControllerBase
{
    private readonly GovernanceDbContext _db;
    private readonly ChatService _chat;
    private readonly TeamsApi _teams;
    private readonly BotFrameworkAuth _auth;
    private readonly TenantContext _tenant;
    private readonly ILogger<TeamsEndpointsController> _log;

    public TeamsEndpointsController(GovernanceDbContext db, ChatService chat, TeamsApi teams, BotFrameworkAuth auth, TenantContext tenant, ILogger<TeamsEndpointsController> log)
    { _db = db; _chat = chat; _teams = teams; _auth = auth; _tenant = tenant; _log = log; }

    [HttpPost]
    public async Task<IActionResult> Post(Guid appId, [FromBody] JsonElement activity, CancellationToken ct)
    {
        var app = await _db.ChatApps.IgnoreQueryFilters().FirstOrDefaultAsync(a => a.Id == appId && a.Platform == "Teams" && a.IsEnabled, ct);
        if (app?.TeamsAppId is null) return NotFound();
        string? S(JsonElement e, params string[] path)
        {
            foreach (var p in path) { if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(p, out e)) return null; }
            return e.ValueKind == JsonValueKind.String ? e.GetString() : null;
        }
        var serviceUrl = S(activity, "serviceUrl");
        var (ok, error) = await _auth.ValidateAsync(Request.Headers.Authorization.ToString(), app.TeamsAppId, serviceUrl, ct);
        if (!ok) { _log.LogInformation("Teams isteği reddedildi: {Error}", error); return Unauthorized(); }
        // Yalnızca botun kayıtlı olduğu Microsoft 365 kiracısından gelen konuşmalar.
        var msTenant = S(activity, "conversation", "tenantId") ?? S(activity, "channelData", "tenant", "id");
        if (msTenant is not null && app.TeamsAzureTenantId is not null && !string.Equals(msTenant, app.TeamsAzureTenantId, StringComparison.OrdinalIgnoreCase))
            return StatusCode(403);
        if (await TransferGuard.MissingAsync(_db, app.TenantSlug, "microsoft", ct) is not null) return Ok();
        _tenant.TenantSlug = app.TenantSlug;

        var type = S(activity, "type");
        var conversationId = S(activity, "conversation", "id");
        var personal = S(activity, "conversation", "conversationType") is null or "personal";
        var fromId = S(activity, "from", "id");
        if (serviceUrl is null || conversationId is null || fromId is null) return Ok();

        try
        {
            var token = await _chat.TeamsTokenAsync(app, ct);
            if (type is "conversationUpdate" or "installationUpdate")
            {
                var botId = S(activity, "recipient", "id");
                var added = activity.TryGetProperty("membersAdded", out var m) && m.EnumerateArray().Any(x => S(x, "id") == botId);
                if ((added || S(activity, "action") == "add") && personal)
                {
                    var who = await _chat.EnsureTeamsIdentityAsync(_db, app, fromId, S(activity, "from", "aadObjectId"), serviceUrl, conversationId, true, ct);
                    var hello = who.EmployeeId is null
                        ? $"Merhaba! HR360'a hoş geldiniz. Microsoft hesabınız ({who.Email ?? "e-posta görünmüyor"}) bir çalışan kaydıyla eşleşmedi; İK'nızdan e-postanızı kontrol etmesini isteyin."
                        : "Merhaba! Onay talepleriniz artık buraya gelecek.\n" + ChatService.Help;
                    await _teams.PostActivityAsync(token, serviceUrl, conversationId, ChatFormat.TeamsActivity(ChatFormat.TeamsTextCard(hello, null), hello), ct);
                }
                return Ok();
            }
            if (type != "message") return Ok();

            var identity = await _chat.EnsureTeamsIdentityAsync(_db, app, fromId, S(activity, "from", "aadObjectId"), serviceUrl, conversationId, personal, ct);
            if (activity.TryGetProperty("value", out var value) && S(value, "hr360") == "decide")
            {
                if (!Guid.TryParse(S(value, "wf"), out var wfId) || !Guid.TryParse(S(value, "step"), out var stepId)) return Ok();
                var approve = S(value, "decision") == "approve";
                var replyToId = S(activity, "replyToId") ?? "";
                var tracked = await _db.ChatMessages.AnyAsync(x => x.AppId == app.Id && x.StepId == stepId && x.State == "Open" && x.MessageId == replyToId, ct);
                var result = await _chat.DecideAsync(_db, app, identity, wfId, stepId, approve, ct);
                var replyTo = S(activity, "replyToId");
                if (result.Ok && !tracked && replyTo is not null)
                {
                    // Komut yanıtındaki kart (kayıtlı değil): kartı sonuçla değiştir.
                    var card = ChatFormat.TeamsTextCard($"{(approve ? "✅" : "⛔")} {result.Message}", ChatService.WorkflowUrl(wfId));
                    var update = ChatFormat.TeamsActivity(card, result.Message);
                    update["id"] = replyTo;
                    try { await _teams.UpdateActivityAsync(token, serviceUrl, conversationId, replyTo, update, ct); } catch (ChatApiException) { }
                }
                if (!result.Ok)
                    await _teams.PostActivityAsync(token, serviceUrl, conversationId, ChatFormat.TeamsActivity(ChatFormat.TeamsTextCard("⚠️ " + result.Message, ChatService.WorkflowUrl(wfId)), result.Message), ct);
                return Ok();
            }

            var reply = await _chat.CommandAsync(identity, S(activity, "text"), ct);
            foreach (var a in ChatFormat.TeamsReply(reply))
            {
                if (S(activity, "id") is { } id) a["replyToId"] = id;
                await _teams.PostActivityAsync(token, serviceUrl, conversationId, a, ct);
            }
        }
        catch (Exception ex) when (ex is ChatApiException or HttpRequestException)
        {
            _log.LogWarning("Teams etkinliği işlenemedi: {Message}", ex.Message);
            app.LastError = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC — {ex.Message}";
            await _db.SaveChangesAsync(ct);
        }
        return Ok();
    }
}

/// <summary>
/// İstek gövdesini model bağlamadan ÖNCE tamponlar. Gerekli: form gövdeli isteklerde
/// MVC'nin form değer sağlayıcısı gövdeyi okuyup tüketir; Slack imzası ise ham
/// gövde üzerinden hesaplanır.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class BufferBodyAttribute : Attribute, Microsoft.AspNetCore.Mvc.Filters.IResourceFilter
{
    public void OnResourceExecuting(Microsoft.AspNetCore.Mvc.Filters.ResourceExecutingContext context) => context.HttpContext.Request.EnableBuffering();
    public void OnResourceExecuted(Microsoft.AspNetCore.Mvc.Filters.ResourceExecutedContext context) { }
}

/// <summary>Teams uygulama paketi için basit PNG simgeleri (harici kitaplık gerektirmez).</summary>
public static class Png
{
    public static byte[] Icon(int size, bool color)
    {
        // RGBA; renkli: zümrüt zemin + beyaz "360" halkası; dış hat: saydam zemin + beyaz halka.
        var px = new byte[size * size * 4];
        double c = (size - 1) / 2.0, rOut = size * 0.36, rIn = size * 0.24;
        for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                var i = (y * size + x) * 4;
                var d = Math.Sqrt((x - c) * (x - c) + (y - c) * (y - c));
                var ring = d <= rOut && d >= rIn && !(x > c && Math.Abs(y - c) < size * 0.06);
                if (color)
                {
                    (px[i], px[i + 1], px[i + 2], px[i + 3]) = ring ? ((byte)255, (byte)255, (byte)255, (byte)255) : ((byte)15, (byte)118, (byte)110, (byte)255);
                }
                else if (ring) (px[i], px[i + 1], px[i + 2], px[i + 3]) = (255, 255, 255, 255);
            }
        using var raw = new MemoryStream();
        for (int y = 0; y < size; y++) { raw.WriteByte(0); raw.Write(px, y * size * 4, size * 4); }
        byte[] compressed;
        using (var z = new MemoryStream())
        {
            using (var zs = new ZLibStream(z, CompressionLevel.Optimal, leaveOpen: true)) zs.Write(raw.ToArray());
            compressed = z.ToArray();
        }
        using var png = new MemoryStream();
        png.Write([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        void Chunk(string type, byte[] data)
        {
            var len = BitConverter.GetBytes(data.Length); if (BitConverter.IsLittleEndian) Array.Reverse(len);
            png.Write(len);
            var td = Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
            png.Write(td);
            var crc = BitConverter.GetBytes(Crc32(td)); if (BitConverter.IsLittleEndian) Array.Reverse(crc);
            png.Write(crc);
        }
        var ihdr = new byte[13];
        var w = BitConverter.GetBytes(size); if (BitConverter.IsLittleEndian) Array.Reverse(w);
        w.CopyTo(ihdr, 0); w.CopyTo(ihdr, 4);
        ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
        Chunk("IHDR", ihdr);
        Chunk("IDAT", compressed);
        Chunk("IEND", []);
        return png.ToArray();
    }

    private static uint Crc32(byte[] data)
    {
        uint crc = 0xFFFFFFFF;
        foreach (var b in data)
        {
            crc ^= b;
            for (int k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }
}
