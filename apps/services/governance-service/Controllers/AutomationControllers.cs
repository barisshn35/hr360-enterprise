using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;
using GovernanceService.Models;

namespace GovernanceService.Controllers;

/// <summary>Kural/webhook ekranlarında seçilebilen olay tipleri ve yüklerindeki alanlar.</summary>
public static class EventCatalog
{
    public static readonly (string Type, string Label, string[] Fields)[] Types =
    {
        ("employee.hired", "Çalışan işe alındı", new[] { "EmployeeId", "FirstName", "LastName", "Email", "HireDate" }),
        ("employee.assigned", "Görevlendirme yapıldı", new[] { "EmployeeId", "DepartmentId", "PositionTitle", "EffectiveFrom", "FirstName", "LastName" }),
        ("employee.status-changed", "Çalışan durumu değişti", new[] { "EmployeeId", "FirstName", "LastName", "OldStatus", "NewStatus", "EffectiveDate" }),
        ("workflow.submitted", "Onaya gönderildi", new[] { "WorkflowRequestId", "WorkflowType", "RequesterEmployeeId", "RequesterName", "Subject", "ApproverEmployeeId" }),
        ("workflow.approved", "Talep onaylandı", new[] { "WorkflowRequestId", "WorkflowType", "RequesterEmployeeId", "Subject" }),
        ("workflow.rejected", "Talep reddedildi", new[] { "WorkflowRequestId", "WorkflowType", "RequesterEmployeeId", "Subject" }),
        ("leave.approved", "İzin onaylandı", new[] { "LeaveRequestId", "EmployeeId", "Type", "StartDate", "EndDate", "Days" }),
        ("*", "Tüm olaylar", Array.Empty<string>()),
    };
}

/* ======================================================================
 * Kural motoru: "olay X olduğunda, koşullar sağlanıyorsa, şunları yap".
 * Örn. "5 günden uzun izin onaylandığında İK kanalına Slack mesajı at".
 * Değerlendirme governance-service'in Kafka tüketicisinde çalışır.
 * ==================================================================== */
[Route("api/rules")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class RulesController : AppController
{
    private readonly GovernanceDbContext _db;
    public RulesController(GovernanceDbContext db) => _db = db;

    [HttpGet("catalog")]
    public IActionResult Catalog() => Ok(new
    {
        events = EventCatalog.Types.Select(t => new { type = t.Type, label = t.Label, fields = t.Fields }),
        operators = new[] { new { op = "eq", label = "eşittir" }, new { op = "neq", label = "eşit değil" }, new { op = "gt", label = "büyüktür" },
            new { op = "gte", label = "büyük/eşit" }, new { op = "lt", label = "küçüktür" }, new { op = "lte", label = "küçük/eşit" }, new { op = "contains", label = "içerir" } },
        actions = new[] { new { type = "notify", label = "Uygulama içi bildirim" }, new { type = "slack", label = "Slack mesajı" },
            new { type = "teams", label = "Teams mesajı" }, new { type = "webhook", label = "Webhook (HTTP POST)" } },
    });

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(await _db.Rules.AsNoTracking().OrderBy(r => r.Name).ToListAsync(ct));

    public record RuleInput(string Name, string? Description, string Trigger, List<RuleCondition>? Conditions, List<RuleAction>? Actions, bool IsEnabled);

    private IActionResult? Validate(RuleInput b)
    {
        if (string.IsNullOrWhiteSpace(b.Name)) return BadRequest(new { message = "Kural adı zorunlu." });
        if (EventCatalog.Types.All(t => t.Type != b.Trigger)) return BadRequest(new { message = "Geçersiz tetikleyici." });
        if (b.Actions is null || b.Actions.Count == 0) return BadRequest(new { message = "En az bir eylem gerekli." });
        if (b.Actions.Any(a => a.Type is not ("notify" or "slack" or "teams" or "webhook"))) return BadRequest(new { message = "Geçersiz eylem." });
        if (b.Actions.Any(a => a.Type == "webhook" && !Uri.TryCreate(a.Target, UriKind.Absolute, out _))) return BadRequest(new { message = "Webhook adresi geçersiz." });
        return null;
    }

    [HttpPost]
    public async Task<IActionResult> Create(RuleInput body, CancellationToken ct)
    {
        if (Validate(body) is { } err) return err;
        var r = new Rule { Name = body.Name.Trim(), Description = body.Description, Trigger = body.Trigger, Conditions = body.Conditions ?? new(), Actions = body.Actions!, IsEnabled = body.IsEnabled };
        _db.Rules.Add(r);
        await _db.SaveChangesAsync(ct);
        return Ok(r);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, RuleInput body, CancellationToken ct)
    {
        if (Validate(body) is { } err) return err;
        var r = await _db.Rules.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return NotFound();
        r.Name = body.Name.Trim(); r.Description = body.Description; r.Trigger = body.Trigger;
        r.Conditions = body.Conditions ?? new(); r.Actions = body.Actions!; r.IsEnabled = body.IsEnabled;
        _db.Entry(r).Property(x => x.Conditions).IsModified = true;
        _db.Entry(r).Property(x => x.Actions).IsModified = true;
        await _db.SaveChangesAsync(ct);
        return Ok(r);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var r = await _db.Rules.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return NotFound();
        _db.Rules.Remove(r);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    public record TestInput(List<RuleCondition> Conditions, List<RuleAction>? Actions, JsonElement Payload);

    /// <summary>Kuralı örnek bir olay yüküne karşı kuru çalıştırır (hiçbir şey göndermez).</summary>
    [HttpPost("test")]
    public IActionResult Test(TestInput body)
    {
        var (matched, why) = Dispatcher.Evaluate(body.Conditions, body.Payload);
        var preview = (body.Actions ?? new()).Select(a => new { a.Type, a.Target, message = Dispatcher.Render(string.IsNullOrWhiteSpace(a.Message) ? "{{ozet}}" : a.Message, body.Payload, "örnek olay") });
        return Ok(new { matched, reason = why, actions = matched ? preview : null });
    }

    [HttpGet("runs")]
    public async Task<IActionResult> Runs([FromQuery] Guid? ruleId, CancellationToken ct)
    {
        var q = _db.RuleRuns.AsNoTracking();
        if (ruleId is not null) q = q.Where(r => r.RuleId == ruleId);
        return Ok(await q.OrderByDescending(r => r.OccurredAt).Take(100).ToListAsync(ct));
    }

    [HttpPost("samples")]
    public async Task<IActionResult> Samples(CancellationToken ct)
    {
        if (await _db.Rules.AnyAsync(ct)) return Conflict(new { message = "Zaten kural tanımlı." });
        _db.Rules.Add(new Rule
        {
            Name = "Uzun izin bildirimi", Description = "5 günden uzun izin onaylandığında çalışana iyi tatiller mesajı.", Trigger = "leave.approved",
            Conditions = new() { new() { Field = "Days", Op = "gt", Value = "5" } },
            Actions = new() { new() { Type = "notify", Target = "employee", Message = "{{Days}} günlük izniniz onaylandı. {{StartDate}} — iyi dinlenmeler!" } },
        });
        _db.Rules.Add(new Rule
        {
            Name = "Yeni çalışan → İK kanalı", Description = "İşe alımda Slack/Teams kanallarına duyuru.", Trigger = "employee.hired",
            Actions = new() { new() { Type = "slack", Message = "Aramıza yeni katılan {{FirstName}} {{LastName}}'a hoş geldin diyelim! 🎉" } }, IsEnabled = false,
        });
        _db.Rules.Add(new Rule
        {
            Name = "Ayrılışta onay sahibine bilgi", Description = "Çalışan ayrıldığında kendisine veda notu.", Trigger = "employee.status-changed",
            Conditions = new() { new() { Field = "NewStatus", Op = "eq", Value = "Terminated" } },
            Actions = new() { new() { Type = "notify", Target = "employee", Message = "{{FirstName}}, birlikte çalıştığımız için teşekkürler." } }, IsEnabled = false,
        });
        await _db.SaveChangesAsync(ct);
        return Ok(new { added = 3 });
    }
}

/* ======================================================================
 * Giden webhook'lar (HMAC-SHA256 imzalı) + test alıcısı. Test alıcısı,
 * dış ağa çıkmadan imzalı teslimatı uçtan uca görmeyi sağlar.
 * ==================================================================== */
[Route("api/webhooks")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class WebhooksController : AppController
{
    private static readonly ConcurrentDictionary<string, ConcurrentQueue<object>> Inbox = new();
    private readonly GovernanceDbContext _db;
    private readonly Dispatcher _dispatcher;
    public WebhooksController(GovernanceDbContext db, Dispatcher dispatcher) { _db = db; _dispatcher = dispatcher; }

    private static string NewSecret() => "whsec_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) => Ok(await _db.Webhooks.AsNoTracking().OrderBy(w => w.Name).ToListAsync(ct));

    public record HookInput(string Name, string Url, List<string> Events, bool IsEnabled);

    [HttpPost]
    public async Task<IActionResult> Create(HookInput body, CancellationToken ct)
    {
        if (!Uri.TryCreate(body.Url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
            return BadRequest(new { message = "Geçerli bir http(s) adresi girin." });
        if (body.Events.Count == 0) return BadRequest(new { message = "En az bir olay seçin." });
        var w = new Webhook { Name = body.Name.Trim(), Url = body.Url, Events = body.Events, IsEnabled = body.IsEnabled, Secret = NewSecret() };
        _db.Webhooks.Add(w);
        await _db.SaveChangesAsync(ct);
        return Ok(w);
    }

    /// <summary>Servisin kendi test alıcısına bağlı bir webhook oluşturur.</summary>
    [HttpPost("test-receiver")]
    public async Task<IActionResult> CreateTestReceiver(CancellationToken ct)
    {
        var token = Guid.NewGuid().ToString("N")[..12];
        var w = new Webhook
        {
            Name = "Test alıcısı", Url = $"http://governance-service:8080/api/webhooks/inbox/{token}", Events = new() { "*" }, Secret = NewSecret(),
        };
        _db.Webhooks.Add(w);
        await _db.SaveChangesAsync(ct);
        return Ok(new { w.Id, token });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, HookInput body, CancellationToken ct)
    {
        var w = await _db.Webhooks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (w is null) return NotFound();
        if (!Uri.TryCreate(body.Url, UriKind.Absolute, out _)) return BadRequest(new { message = "Adres geçersiz." });
        w.Name = body.Name.Trim(); w.Url = body.Url; w.Events = body.Events; w.IsEnabled = body.IsEnabled;
        if (body.IsEnabled) w.FailureCount = 0;
        await _db.SaveChangesAsync(ct);
        return Ok(w);
    }

    [HttpPost("{id:guid}/rotate-secret")]
    public async Task<IActionResult> Rotate(Guid id, CancellationToken ct)
    {
        var w = await _db.Webhooks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (w is null) return NotFound();
        w.Secret = NewSecret();
        await _db.SaveChangesAsync(ct);
        return Ok(new { w.Secret });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var w = await _db.Webhooks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (w is null) return NotFound();
        _db.Webhooks.Remove(w);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/ping")]
    public async Task<IActionResult> Ping(Guid id, CancellationToken ct)
    {
        var w = await _db.Webhooks.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (w is null) return NotFound();
        var payload = JsonDocument.Parse(JsonSerializer.Serialize(new { TenantSlug = w.TenantSlug, message = "HR360 webhook testi", at = DateTime.UtcNow })).RootElement;
        await _dispatcher.DeliverWebhookAsync(_db, w, Guid.NewGuid(), "ping", payload, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(new { w.LastStatus, ok = w.LastStatus is >= 200 and < 300 });
    }

    [HttpGet("{id:guid}/deliveries")]
    public async Task<IActionResult> Deliveries(Guid id, CancellationToken ct) =>
        Ok(await _db.WebhookDeliveries.AsNoTracking().Where(d => d.WebhookId == id).OrderByDescending(d => d.OccurredAt).Take(50).ToListAsync(ct));

    /// <summary>Test alıcısı: imzayı doğrular ve son 50 teslimatı bellekte tutar.</summary>
    [HttpPost("inbox/{token}")]
    [AllowAnonymous]
    public async Task<IActionResult> Receive(string token, CancellationToken ct)
    {
        using var reader = new StreamReader(Request.Body, Encoding.UTF8);
        var body = await reader.ReadToEndAsync(ct);
        var sig = Request.Headers["X-HR360-Signature"].FirstOrDefault();
        var secret = await Db.ScalarAsync("SELECT \"Secret\" FROM governance_webhooks WHERE \"Url\" LIKE $1 LIMIT 1", ct, $"%/inbox/{token}") as string;
        bool? valid = secret is null || sig is null ? null
            : CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(sig),
                Encoding.UTF8.GetBytes("sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant()));
        var q = Inbox.GetOrAdd(token, _ => new ConcurrentQueue<object>());
        q.Enqueue(new { receivedAt = DateTime.UtcNow, @event = Request.Headers["X-HR360-Event"].FirstOrDefault(), signatureValid = valid,
            body = body.Length > 4000 ? body[..4000] : body });
        while (q.Count > 50) q.TryDequeue(out _);
        return Ok(new { received = true });
    }

    [HttpGet("inbox/{token}")]
    public IActionResult ReadInbox(string token) =>
        Ok(Inbox.TryGetValue(token, out var q) ? q.Reverse().ToArray() : Array.Empty<object>());
}

/* ======================================================================
 * API anahtarları — açık API (api/public/v1) için. Anahtar yalnızca
 * oluşturulduğu an bir kez gösterilir; veritabanında SHA-256 özeti tutulur.
 * ==================================================================== */
[Route("api/api-keys")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class ApiKeysController : AppController
{
    public static readonly string[] AllScopes = { "employees:read", "departments:read", "leaves:read", "events:read" };
    private readonly GovernanceDbContext _db;
    public ApiKeysController(GovernanceDbContext db) => _db = db;

    public static string Hash(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant();

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok((await _db.ApiKeys.AsNoTracking().OrderByDescending(k => k.CreatedAt).ToListAsync(ct))
            .Select(k => new { k.Id, k.Name, k.Prefix, k.Scopes, k.CreatedByName, k.CreatedAt, k.LastUsedAt, k.RevokedAt, active = k.RevokedAt == null }));

    [HttpGet("scopes")]
    public IActionResult Scopes() => Ok(AllScopes);

    public record KeyInput(string Name, List<string> Scopes);

    [HttpPost]
    public async Task<IActionResult> Create(KeyInput body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name)) return BadRequest(new { message = "Ad zorunlu." });
        var scopes = body.Scopes.Where(AllScopes.Contains).Distinct().ToList();
        if (scopes.Count == 0) return BadRequest(new { message = "En az bir yetki seçin." });
        var prefix = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24)).Replace('+', 'x').Replace('/', 'y').TrimEnd('=');
        var key = $"hr360_{prefix}_{secret}";
        var k = new ApiKey { Name = body.Name.Trim(), Prefix = prefix, KeyHash = Hash(key), Scopes = scopes, CreatedByName = Me.Name };
        _db.ApiKeys.Add(k);
        await _db.SaveChangesAsync(ct);
        return Ok(new { k.Id, k.Name, k.Prefix, k.Scopes, key });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Revoke(Guid id, CancellationToken ct)
    {
        var k = await _db.ApiKeys.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (k is null) return NotFound();
        k.RevokedAt ??= DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }
}

/* ======================================================================
 * Açık API v1 — X-Api-Key ile. Salt okunur; anahtarın kiracısı ve
 * yetkileri (scope) dışına çıkamaz. Dakikada 120 istek sınırı.
 * ==================================================================== */
[ApiController]
[Route("api/public/v1")]
[AllowAnonymous]
public class PublicApiController : ControllerBase
{
    private static readonly ConcurrentDictionary<string, (int Count, DateTime Window)> Rate = new();
    private readonly Sql _sql;
    public PublicApiController(Sql sql) => _sql = sql;

    private async Task<(string? Tenant, IActionResult? Error)> AuthorizeAsync(string scope, CancellationToken ct)
    {
        var key = Request.Headers["X-Api-Key"].FirstOrDefault();
        if (string.IsNullOrEmpty(key)) return (null, Unauthorized(new { message = "X-Api-Key başlığı gerekli." }));
        var hash = ApiKeysController.Hash(key);
        var row = (await _sql.QueryAsync("""
            SELECT k."Id", k."TenantSlug", k."Scopes", t."Plan", t."Status" FROM governance_api_keys k
            JOIN platform_tenants t ON t."Slug" = k."TenantSlug"
            WHERE k."KeyHash" = $1 AND k."RevokedAt" IS NULL
            """, r => (Id: r.GetGuid(0), Tenant: r.GetString(1), Scopes: r.GetFieldValue<string[]>(2), Plan: r.GetString(3), Status: r.GetString(4)), ct, hash)).FirstOrDefault();
        if (row.Tenant is null) return (null, Unauthorized(new { message = "Geçersiz veya iptal edilmiş anahtar." }));
        if (row.Status != "Active") return (null, StatusCode(403, new { message = "Şirket hesabı aktif değil." }));
        if (RequiresPlanAttribute.Rank(row.Plan) < 3) return (null, StatusCode(402, new { message = "Açık API Enterprise planında kullanılabilir." }));
        if (!row.Scopes.Contains(scope)) return (null, StatusCode(403, new { message = $"Anahtarın '{scope}' yetkisi yok." }));

        var now = DateTime.UtcNow;
        var cur = Rate.AddOrUpdate(hash, _ => (1, now), (_, v) => now - v.Window > TimeSpan.FromMinutes(1) ? (1, now) : (v.Count + 1, v.Window));
        Response.Headers["X-RateLimit-Limit"] = "120";
        Response.Headers["X-RateLimit-Remaining"] = Math.Max(0, 120 - cur.Count).ToString();
        if (cur.Count > 120) return (null, StatusCode(429, new { message = "Dakikalık istek sınırı aşıldı." }));
        await _sql.ExecuteAsync("UPDATE governance_api_keys SET \"LastUsedAt\" = now() WHERE \"Id\" = $1", ct, row.Id);
        return (row.Tenant, null);
    }

    [HttpGet("employees")]
    public async Task<IActionResult> Employees([FromQuery] string? status, CancellationToken ct)
    {
        var (tenant, err) = await AuthorizeAsync("employees:read", ct);
        if (err is not null) return err;
        var people = await new PeopleDirectory(_sql).ListAsync(tenant!, ct, includeTerminated: status == "all");
        return Ok(new { data = people.Select(p => new { id = p.Id, name = p.Name, email = p.Email, position = p.Position, departmentId = p.DepartmentId, department = p.Department, hireDate = p.HireDate, status = p.Status }) });
    }

    [HttpGet("departments")]
    public async Task<IActionResult> Departments(CancellationToken ct)
    {
        var (tenant, err) = await AuthorizeAsync("departments:read", ct);
        if (err is not null) return err;
        var rows = await _sql.QueryAsync("SELECT \"Id\", \"Name\", \"ParentDepartmentId\", \"HeadEmployeeId\" FROM organization_departments WHERE \"TenantSlug\" = $1 ORDER BY 2",
            r => new { id = r.GetGuid(0), name = r.GetString(1), parentId = r.GuidOrNull(2), headEmployeeId = r.GuidOrNull(3) }, ct, tenant);
        return Ok(new { data = rows });
    }

    [HttpGet("leaves")]
    public async Task<IActionResult> Leaves([FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        var (tenant, err) = await AuthorizeAsync("leaves:read", ct);
        if (err is not null) return err;
        var f = from ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
        var t = to ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(90));
        var rows = await _sql.QueryAsync("""
            SELECT "Id", "EmployeeId", "Type", "StartDate", "EndDate", "Days", "Status" FROM leave_requests
            WHERE "TenantSlug" = $1 AND "StartDate" <= $3 AND "EndDate" >= $2 AND "Status" IN ('Approved','Submitted') ORDER BY "StartDate"
            """, r => new { id = r.GetGuid(0), employeeId = r.GetGuid(1), type = r.GetString(2), startDate = r.GetFieldValue<DateOnly>(3),
                endDate = r.GetFieldValue<DateOnly>(4), days = r.GetDecimal(5), status = r.GetString(6) }, ct, tenant, f, t);
        return Ok(new { data = rows });
    }

    [HttpGet("events")]
    public async Task<IActionResult> Events([FromQuery] DateTime? since, CancellationToken ct)
    {
        var (tenant, err) = await AuthorizeAsync("events:read", ct);
        if (err is not null) return err;
        var s = since is null ? DateTime.UtcNow.AddDays(-1) : DateTime.SpecifyKind(since.Value, DateTimeKind.Utc);
        var rows = await _sql.QueryAsync("""
            SELECT "Id", "EventType", "Payload"::text, "OccurredAt" FROM governance_events
            WHERE "TenantSlug" = $1 AND "OccurredAt" > $2 ORDER BY "OccurredAt" LIMIT 500
            """, r => new { id = r.GetGuid(0), type = r.GetString(1), data = r.IsDBNull(2) ? (JsonElement?)null : JsonDocument.Parse(r.GetString(2)).RootElement.Clone(), occurredAt = r.GetFieldValue<DateTime>(3) },
            ct, tenant, s);
        return Ok(new { data = rows });
    }

    [HttpGet("openapi.json")]
    public IActionResult Spec() => Ok(new
    {
        openapi = "3.0.3",
        info = new { title = "HR360 Açık API", version = "1.0", description = "X-Api-Key başlığı ile kimlik doğrulama. Salt okunur." },
        servers = new[] { new { url = "/api/governance/public/v1" } },
        components = new { securitySchemes = new { apiKey = new { type = "apiKey", @in = "header", name = "X-Api-Key" } } },
        security = new[] { new Dictionary<string, string[]> { ["apiKey"] = Array.Empty<string>() } },
        paths = new Dictionary<string, object>
        {
            ["/employees"] = new { get = new { summary = "Çalışanlar (scope: employees:read)", parameters = new[] { new { name = "status", @in = "query", schema = new { type = "string", @enum = new[] { "all" } } } } } },
            ["/departments"] = new { get = new { summary = "Departmanlar (scope: departments:read)" } },
            ["/leaves"] = new { get = new { summary = "İzinler (scope: leaves:read)", parameters = new[] { new { name = "from", @in = "query", schema = new { type = "string", format = "date" } }, new { name = "to", @in = "query", schema = new { type = "string", format = "date" } } } } },
            ["/events"] = new { get = new { summary = "Olay akışı (scope: events:read)", parameters = new[] { new { name = "since", @in = "query", schema = new { type = "string", format = "date-time" } } } } },
        },
    });
}

/* ======================================================================
 * Slack / Microsoft Teams: gelen webhook'larla kanala bildirim + Slack
 * slash komutu (/hr360 izindekiler | kimnerede | bekleyen).
 * ==================================================================== */
[Route("api/integrations")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Enterprise")]
public class IntegrationsController : AppController
{
    private readonly GovernanceDbContext _db;
    private readonly Dispatcher _dispatcher;
    public IntegrationsController(GovernanceDbContext db, Dispatcher dispatcher) { _db = db; _dispatcher = dispatcher; }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok((await _db.Integrations.AsNoTracking().OrderBy(i => i.Kind).ThenBy(i => i.Name).ToListAsync(ct))
            .Select(i => new { i.Id, i.Kind, i.Name, webhookUrl = MaskUrl(i.WebhookUrl), i.Events, i.IsEnabled, i.LastStatus, i.CreatedAt, hasSigningSecret = i.SigningSecret != null }));

    private static string MaskUrl(string url) => url.Length <= 32 ? url : url[..28] + "…" + url[^4..];

    public record IntegrationInput(string Kind, string Name, string WebhookUrl, List<string> Events, string? SigningSecret, bool IsEnabled);

    [HttpPost]
    public async Task<IActionResult> Create(IntegrationInput body, CancellationToken ct)
    {
        if (body.Kind is not ("Slack" or "Teams")) return BadRequest(new { message = "Tür Slack veya Teams olmalı." });
        if (!Uri.TryCreate(body.WebhookUrl, UriKind.Absolute, out _)) return BadRequest(new { message = "Gelen webhook adresi geçersiz." });
        var i = new Integration { Kind = body.Kind, Name = body.Name.Trim(), WebhookUrl = body.WebhookUrl.Trim(), Events = body.Events, SigningSecret = body.SigningSecret, IsEnabled = body.IsEnabled };
        _db.Integrations.Add(i);
        await _db.SaveChangesAsync(ct);
        return Ok(new { i.Id });
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, IntegrationInput body, CancellationToken ct)
    {
        var i = await _db.Integrations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (i is null) return NotFound();
        i.Name = body.Name.Trim();
        if (!string.IsNullOrWhiteSpace(body.WebhookUrl) && !body.WebhookUrl.Contains('…')) i.WebhookUrl = body.WebhookUrl.Trim();
        i.Events = body.Events;
        if (body.SigningSecret is not null) i.SigningSecret = body.SigningSecret.Length == 0 ? null : body.SigningSecret;
        i.IsEnabled = body.IsEnabled;
        await _db.SaveChangesAsync(ct);
        return Ok(new { i.Id });
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var i = await _db.Integrations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (i is null) return NotFound();
        _db.Integrations.Remove(i);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("{id:guid}/test")]
    public async Task<IActionResult> Test(Guid id, CancellationToken ct)
    {
        var i = await _db.Integrations.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (i is null) return NotFound();
        i.LastStatus = await _dispatcher.PostChatAsync(i.Kind, i.WebhookUrl, "Bağlantı testi — bu kanal HR360 bildirimlerini alacak.", "test", ct);
        await _db.SaveChangesAsync(ct);
        return Ok(new { i.LastStatus, ok = i.LastStatus is >= 200 and < 300 });
    }

    /// <summary>Slack slash komutu. Slack uygulamasında Request URL olarak bu adres verilir.</summary>
    [HttpPost("{id:guid}/slack-command")]
    [AllowAnonymous]
    [BufferBody]
    public async Task<IActionResult> SlackCommand(Guid id, CancellationToken ct)
    {
        // Gövde model bağlamadan önce tamponlandı (BufferBody); imza ham gövdeyle doğrulanır.
        Request.Body.Position = 0;
        string raw;
        using (var reader = new StreamReader(Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 4096, leaveOpen: true))
            raw = await reader.ReadToEndAsync(ct);
        Request.Body.Position = 0;
        var row = (await Db.QueryAsync("SELECT \"TenantSlug\", \"SigningSecret\" FROM governance_integrations WHERE \"Id\" = $1 AND \"Kind\" = 'Slack' AND \"IsEnabled\"",
            r => (Tenant: r.GetString(0), Secret: r.Str(1)), ct, id)).FirstOrDefault();
        if (row.Tenant is null) return NotFound();
        if (row.Secret is not null)
        {
            var ts = Request.Headers["X-Slack-Request-Timestamp"].FirstOrDefault() ?? "";
            var sig = Request.Headers["X-Slack-Signature"].FirstOrDefault() ?? "";
            if (!long.TryParse(ts, out var t) || Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - t) > 300) return Unauthorized();
            var expected = "v0=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(row.Secret), Encoding.UTF8.GetBytes($"v0:{ts}:{raw}"))).ToLowerInvariant();
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(sig))) return Unauthorized();
        }
        var form = Request.HasFormContentType ? await Request.ReadFormAsync(ct) : null;
        var text = (form?["text"].ToString() ?? "").Trim().ToLowerInvariant();
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        string reply;
        switch (text)
        {
            case "izindekiler":
                var onLeave = await Db.QueryAsync("""
                    SELECT e."FirstName" || ' ' || e."LastName", l."EndDate" FROM leave_requests l JOIN employee_employees e ON e."Id" = l."EmployeeId"
                    WHERE l."TenantSlug" = $1 AND l."Status" = 'Approved' AND l."StartDate" <= $2 AND l."EndDate" >= $2 ORDER BY 1
                    """, r => $"• {r.GetString(0)} ({r.GetFieldValue<DateOnly>(1):dd.MM}'e kadar)", ct, row.Tenant, today);
                reply = onLeave.Count == 0 ? "Bugün izinde olan kimse yok." : $"*Bugün izinde ({onLeave.Count}):*\n" + string.Join("\n", onLeave);
                break;
            case "kimnerede":
                var modes = await Db.QueryAsync("SELECT \"Mode\", count(*) FROM engagement_presence WHERE \"TenantSlug\" = $1 AND \"Date\" = $2 GROUP BY 1",
                    r => (Mode: r.GetString(0), N: r.GetInt64(1)), ct, row.Tenant, today);
                string L(string m) => m switch { "Office" => "Ofiste", "Remote" => "Uzaktan", "Travel" => "Seyahatte", "Off" => "Çalışmıyor", _ => m };
                reply = modes.Count == 0 ? "Bugün için çalışma yeri bildiren olmadı." : "*Bugün:* " + string.Join(" · ", modes.Select(m => $"{L(m.Mode)} {m.N}"));
                break;
            case "bekleyen":
                var pending = Convert.ToInt64(await Db.ScalarAsync("SELECT count(*) FROM workflow_requests WHERE \"TenantSlug\" = $1 AND \"Status\" = 'Pending'", ct, row.Tenant));
                reply = $"Şirkette onay bekleyen *{pending}* talep var.";
                break;
            default:
                reply = "Kullanım: `/hr360 izindekiler` · `/hr360 kimnerede` · `/hr360 bekleyen`";
                break;
        }
        return Ok(new { response_type = "ephemeral", text = reply });
    }
}
