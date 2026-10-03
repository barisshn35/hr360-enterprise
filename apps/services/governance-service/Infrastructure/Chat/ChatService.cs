using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Models;
using GovernanceService.Tenancy;

namespace GovernanceService.Infrastructure.Chat;

/// <summary>Bekleyen bir onay adımı (mesaj içeriği için).</summary>
public sealed record PendingApproval(Guid WorkflowId, Guid StepId, string Type, string? Subject, string? Requester, DateTime? SlaDueAt, string? Details);

/// <summary>Komut yanıtı: metin ve (varsa) düğmeli onay listesi.</summary>
public sealed record ChatReply(string Text, IReadOnlyList<PendingApproval> Approvals);

/// <summary>
/// Slack ve Teams için ortak iş mantığı: onaycıya düğmeli mesaj, karar verme
/// (workflow-service iç ucu üzerinden), talep sahibine sonuç bildirimi, komutlar.
/// Platforma özgü biçim <see cref="ChatFormat"/>'tadır.
/// </summary>
public sealed class ChatService
{
    private readonly Sql _sql;
    private readonly SlackApi _slack;
    private readonly TeamsApi _teams;
    private readonly IHttpClientFactory _http;
    private readonly ILogger<ChatService> _log;
    private static readonly string WorkflowBase = (EnvVar.Or("WORKFLOW_SERVICE_URL", "http://workflow-service:8080")).TrimEnd('/');
    public static readonly string PublicOrigin = (EnvVar.Or("PUBLIC_ORIGIN", "http://localhost")).TrimEnd('/');
    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");

    private readonly PeopleDirectory _people;

    public ChatService(Sql sql, SlackApi slack, TeamsApi teams, IHttpClientFactory http, ILogger<ChatService> log, PeopleDirectory people)
    { _sql = sql; _slack = slack; _teams = teams; _http = http; _log = log; _people = people; }

    // ------------------------------------------------------------------ güvenlik ve veri en aza indirme

    /// <summary>
    /// Sohbet hesabına veri gönderilebilir mi: çalışan kaydı eşleşmiş ve (uygulama istiyorsa)
    /// kişi HR360'a giriş yapıp bağlamayı onaylamış olmalı.
    /// </summary>
    public static bool Trusted(ChatApp app, ChatIdentity who) =>
        who.EmployeeId is not null && (who.VerifiedAt is not null || !app.RequireVerifiedIdentity);

    public static string HashCode(string code) => Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(code)));

    /// <summary>Tek kullanımlık bağlama bağlantısı üretir (yalnızca özeti saklanır).</summary>
    public async Task<string> LinkUrlAsync(GovernanceDbContext db, ChatIdentity who, TimeSpan validity, CancellationToken ct)
    {
        var code = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(18)).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        who.LinkCodeHash = HashCode(code);
        who.LinkCodeExpiresAt = DateTime.UtcNow + validity;
        await db.SaveChangesAsync(ct);
        return $"{PublicOrigin}/panel/sohbet-bagla?kod={code}";
    }

    public static string LinkPrompt(string url, bool forApproval = false) =>
        (forApproval ? "Onayınızı bekleyen bir talep var. " : "")
        + "🔒 Güvenliğiniz için bu sohbet hesabını HR360 hesabınıza bir kez bağlamanız gerekiyor. Bağlantıyı açıp HR360'a giriş yapın ve onaylayın: "
        + url + " (24 saat geçerli)";

    /// <summary>Ayrılan ya da silinen çalışanın sohbet eşleşmesi kaldırılır (her istekte denetlenir).</summary>
    private async Task<bool> EnsureActiveAsync(GovernanceDbContext db, ChatIdentity who, CancellationToken ct)
    {
        if (who.EmployeeId is null) return false;
        var status = await _sql.ScalarAsync("SELECT \"Status\" FROM employee_employees WHERE \"TenantSlug\" = $1 AND \"Id\" = $2", ct, who.TenantSlug, who.EmployeeId.Value) as string;
        if (status is not null && status != "Terminated") return true;
        who.EmployeeId = null; who.VerifiedAt = null; who.LinkCodeHash = null;
        await db.SaveChangesAsync(ct);
        return false;
    }

    /// <summary>"Ayşe Yılmaz" → "Ayşe Y." (Minimal mesaj ayrıntısı).</summary>
    public static string? ShortName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return name;
        var parts = name.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length < 2 ? parts[0] : $"{string.Join(' ', parts[..^1])} {char.ToUpper(parts[^1][0], Tr)}.";
    }

    /// <summary>KVKK veri en aza indirme: yurt dışındaki sohbet hizmetine yalnızca gerekli bilgi gider.</summary>
    public static PendingApproval Shape(ChatApp app, PendingApproval p) =>
        app.MessageDetail == "Standard" ? p : p with { Requester = ShortName(p.Requester), Subject = null };

    public static string TypeLabel(string? type) => type switch
    {
        "LeaveRequest" => "izin", "ExpenseClaim" => "masraf", "PositionChange" => "pozisyon değişikliği",
        "AssetRequest" => "zimmet", _ => "onay",
    };

    public static string LeaveLabel(string type) => type switch
    {
        "Annual" => "Yıllık", "Sick" => "Hastalık", "Unpaid" => "Ücretsiz", "Maternity" => "Doğum", "Paternity" => "Babalık",
        "Marriage" => "Evlilik", "Bereavement" => "Vefat", _ => type,
    };

    public static string WorkflowUrl(Guid id) => $"{PublicOrigin}/panel/onaylar/{id}";

    // ------------------------------------------------------------------ olaylar

    public async Task OnEventAsync(GovernanceDbContext db, string tenant, string type, JsonElement? payload, CancellationToken ct)
    {
        if (type is not ("workflow.submitted" or "workflow.approved" or "workflow.rejected")) return;
        var apps = await db.ChatApps.Where(a => a.TenantSlug == tenant && a.IsEnabled).ToListAsync(ct);
        // KVKK m.9: dayanak kaydı olmayan yurt dışı hizmete veri gönderilmez.
        var allowed = await TransferGuard.AllowedAsync(db, tenant, ct);
        apps = apps.Where(a => allowed.Contains(TransferGuard.KeyOf(a.Platform))).ToList();
        if (apps.Count == 0) return;
        if (!Guid.TryParse(EventHub.Field(payload, "WorkflowRequestId"), out var wfId)) return;

        if (type == "workflow.submitted")
        {
            if (!Guid.TryParse(EventHub.Field(payload, "ApproverEmployeeId"), out var approverId)) return;
            var pending = await PendingStepAsync(tenant, wfId, approverId, ct);
            if (pending is null) return;
            // Sıra bir sonraki adıma geçtiyse önceki adımın mesajındaki düğmeler kaldırılır.
            await CloseMessagesAsync(db, apps, tenant, wfId, keepStep: pending.StepId, "Bu adım onaylandı; talep bir sonraki onaycıya geçti.", ct);
            foreach (var app in apps.Where(a => a.NotifyApprovals))
            {
                try { await SendApprovalAsync(db, app, approverId, EventHub.Field(payload, "ApproverEmail"), pending, ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    await FailAsync(db, app, ex, ct);
                    Enqueue(db, app, "approval", new { approverId, approverEmail = EventHub.Field(payload, "ApproverEmail"), wfId }, ex);
                }
            }
        }
        else
        {
            var approved = type == "workflow.approved";
            Guid.TryParse(EventHub.Field(payload, "DecidedByEmployeeId"), out var decidedBy);
            var who = decidedBy == Guid.Empty ? null : await NameOfAsync(tenant, decidedBy, ct);
            await CloseMessagesAsync(db, apps, tenant, wfId, null, $"{(approved ? "✅ Onaylandı" : "⛔ Reddedildi")}{(who is null ? "" : " — " + who)}", ct);
            if (!Guid.TryParse(EventHub.Field(payload, "RequesterEmployeeId"), out var requesterId)) return;
            var subject = EventHub.Field(payload, "Subject");
            var label = TypeLabel(EventHub.Field(payload, "WorkflowType"));
            var comment = EventHub.Field(payload, "Comment");
            var text = $"{(approved ? "✅" : "⛔")} {char.ToUpper(label[0], Tr)}{label[1..]} talebiniz {(approved ? "onaylandı" : "reddedildi")}: {subject}"
                + (who is null ? "" : $"\nKarar: {who}") + (string.IsNullOrWhiteSpace(comment) ? "" : $"\nNot: {comment}");
            foreach (var app in apps.Where(a => a.NotifyRequesters))
            {
                try { await SendTextToEmployeeAsync(db, app, requesterId, text, WorkflowUrl(wfId), ct); }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    await FailAsync(db, app, ex, ct);
                    Enqueue(db, app, "text", new { employeeId = requesterId, text, link = WorkflowUrl(wfId) }, ex);
                }
            }
        }
        await db.SaveChangesAsync(ct);
    }

    // ------------------------------------------------------------------ yeniden deneme kuyruğu

    /// <summary>Deneme aralıkları (taban × 1, 5, 15, 60, 180). Taban varsayılan 60 sn; testlerde kısaltılır.</summary>
    public static readonly int RetryBaseSeconds = int.TryParse(EnvVar.Or("CHAT_RETRY_BASE_SECONDS", "60"), out var b) && b > 0 ? b : 60;
    private static readonly int[] RetrySteps = { 1, 5, 15, 60, 180 };

    private static void Enqueue(GovernanceDbContext db, ChatApp app, string kind, object payload, Exception ex) =>
        db.ChatOutbox.Add(new ChatOutbox
        {
            TenantSlug = app.TenantSlug, AppId = app.Id, Kind = kind, Payload = JsonSerializer.Serialize(payload),
            Attempts = 1, NextAttemptAt = DateTime.UtcNow.AddSeconds(RetryBaseSeconds * RetrySteps[0]), LastError = Trim(ex.Message),
        });

    private static string Trim(string s) => s.Length > 500 ? s[..500] : s;

    /// <summary>Vadesi gelen kuyruk kayıtlarını dener; başarılı olanı siler, olmayanı erteler, beşinci denemeden sonra bırakır.</summary>
    public async Task<int> ProcessOutboxAsync(GovernanceDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var due = await db.ChatOutbox.IgnoreQueryFilters().Where(o => o.NextAttemptAt <= now).OrderBy(o => o.NextAttemptAt).Take(50).ToListAsync(ct);
        var sent = 0;
        foreach (var o in due)
        {
            var app = await db.ChatApps.IgnoreQueryFilters().FirstOrDefaultAsync(a => a.Id == o.AppId && a.IsEnabled, ct);
            if (app is null || !(await TransferGuard.AllowedAsync(db, o.TenantSlug, ct)).Contains(TransferGuard.KeyOf(app.Platform)))
            {
                db.ChatOutbox.Remove(o);
                continue;
            }
            try
            {
                var p = JsonDocument.Parse(o.Payload).RootElement;
                if (o.Kind == "approval")
                {
                    var approverId = p.GetProperty("approverId").GetGuid();
                    var pending = await PendingStepAsync(o.TenantSlug, p.GetProperty("wfId").GetGuid(), approverId, ct);
                    // Talep bu arada karara bağlandıysa gönderilecek bir şey kalmadı.
                    if (pending is not null)
                        await SendApprovalAsync(db, app, approverId, p.TryGetProperty("approverEmail", out var e) && e.ValueKind == JsonValueKind.String ? e.GetString() : null, pending, ct);
                }
                else if (o.Kind == "text")
                {
                    await SendTextToEmployeeAsync(db, app, p.GetProperty("employeeId").GetGuid(), p.GetProperty("text").GetString() ?? "",
                        p.TryGetProperty("link", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() : null, ct);
                }
                db.ChatOutbox.Remove(o);
                sent++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                o.LastError = Trim(ex.Message);
                if (o.Attempts >= RetrySteps.Length)
                {
                    _log.LogWarning("Sohbet mesajı {Attempts} denemede gönderilemedi, bırakıldı: {Message}", o.Attempts, ex.Message);
                    app.LastError = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC — {o.Attempts} denemede gönderilemedi: {ex.Message}";
                    db.ChatOutbox.Remove(o);
                }
                else
                {
                    o.NextAttemptAt = DateTime.UtcNow.AddSeconds(RetryBaseSeconds * RetrySteps[o.Attempts]);
                    o.Attempts++;
                }
            }
        }
        await db.SaveChangesAsync(ct);
        return sent;
    }

    private async Task FailAsync(GovernanceDbContext db, ChatApp app, Exception ex, CancellationToken ct)
    {
        _log.LogWarning("{Platform} uygulaması ({App}) gönderim hatası: {Message}", app.Platform, app.Id, ex.Message);
        app.LastError = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC — {ex.Message}";
        await Task.CompletedTask;
    }

    public async Task<PendingApproval?> PendingStepAsync(string tenant, Guid wfId, Guid approverId, CancellationToken ct) =>
        (await _sql.QueryAsync("""
            SELECT w."Id", s."Id", w."Type", w."Subject", e."FirstName" || ' ' || e."LastName", w."SlaDueAt", w."Payload"
            FROM workflow_requests w
            JOIN workflow_approval_steps s ON s."WorkflowRequestId" = w."Id" AND s."Decision" = 'Pending'
            LEFT JOIN employee_employees e ON e."Id" = w."RequesterEmployeeId"
            WHERE w."TenantSlug" = $1 AND w."Id" = $2 AND w."Status" = 'Pending'
              AND (s."ApproverEmployeeId" = $3 OR s."DelegatedToEmployeeId" = $3)
              AND NOT EXISTS (SELECT 1 FROM workflow_approval_steps p WHERE p."WorkflowRequestId" = w."Id" AND p."Order" < s."Order" AND p."Decision" = 'Pending')
            ORDER BY s."Order" LIMIT 1
            """, MapPending, ct, tenant, wfId, approverId)).FirstOrDefault();

    public async Task<List<PendingApproval>> MyPendingAsync(string tenant, Guid employeeId, int limit, CancellationToken ct) =>
        await _sql.QueryAsync("""
            SELECT w."Id", s."Id", w."Type", w."Subject", e."FirstName" || ' ' || e."LastName", w."SlaDueAt", w."Payload"
            FROM workflow_requests w
            JOIN workflow_approval_steps s ON s."WorkflowRequestId" = w."Id" AND s."Decision" = 'Pending'
            LEFT JOIN employee_employees e ON e."Id" = w."RequesterEmployeeId"
            WHERE w."TenantSlug" = $1 AND w."Status" = 'Pending' AND w."RequesterEmployeeId" <> $2
              AND (s."ApproverEmployeeId" = $2 OR s."DelegatedToEmployeeId" = $2)
              AND NOT EXISTS (SELECT 1 FROM workflow_approval_steps p WHERE p."WorkflowRequestId" = w."Id" AND p."Order" < s."Order" AND p."Decision" = 'Pending')
            ORDER BY w."CreatedAt" DESC LIMIT $3
            """, MapPending, ct, tenant, employeeId, limit);

    public async Task<long> MyPendingCountAsync(string tenant, Guid employeeId, CancellationToken ct) =>
        Convert.ToInt64(await _sql.ScalarAsync("""
            SELECT count(*) FROM workflow_requests w
            JOIN workflow_approval_steps s ON s."WorkflowRequestId" = w."Id" AND s."Decision" = 'Pending'
            WHERE w."TenantSlug" = $1 AND w."Status" = 'Pending' AND w."RequesterEmployeeId" <> $2
              AND (s."ApproverEmployeeId" = $2 OR s."DelegatedToEmployeeId" = $2)
              AND NOT EXISTS (SELECT 1 FROM workflow_approval_steps p WHERE p."WorkflowRequestId" = w."Id" AND p."Order" < s."Order" AND p."Decision" = 'Pending')
            """, ct, tenant, employeeId));

    private static PendingApproval MapPending(Npgsql.NpgsqlDataReader r) =>
        new(r.GetGuid(0), r.GetGuid(1), r.GetString(2), r.Str(3), r.Str(4), r.Ts(5), Details(r.Str(6)));

    /// <summary>Talep yükünden kısa ayrıntı (izin tarihleri, masraf tutarı). Bilinmeyen yapı sessizce atlanır.</summary>
    private static string? Details(string? payload)
    {
        if (string.IsNullOrWhiteSpace(payload)) return null;
        try
        {
            var p = JsonDocument.Parse(payload).RootElement;
            string? F(params string[] names)
            {
                foreach (var n in names)
                    foreach (var prop in p.EnumerateObject())
                        if (string.Equals(prop.Name, n, StringComparison.OrdinalIgnoreCase) && prop.Value.ValueKind is JsonValueKind.String or JsonValueKind.Number)
                            return prop.Value.ToString();
                return null;
            }
            var start = F("startDate"); var end = F("endDate"); var days = F("days", "totalDays", "workingDays");
            var amount = F("amount", "totalAmount"); var currency = F("currency");
            var parts = new List<string>();
            if (start is not null && end is not null)
                parts.Add(DateOnly.TryParse(start[..Math.Min(10, start.Length)], CultureInfo.InvariantCulture, out var s) && DateOnly.TryParse(end[..Math.Min(10, end.Length)], CultureInfo.InvariantCulture, out var e)
                    ? $"{s.ToString("d MMM", Tr)} – {e.ToString("d MMM yyyy", Tr)}" : $"{start} – {end}");
            if (days is not null) parts.Add($"{days} gün");
            if (amount is not null) parts.Add($"{amount} {currency ?? "TL"}");
            return parts.Count == 0 ? null : string.Join(" · ", parts);
        }
        catch (JsonException) { return null; }
    }

    private async Task<string?> NameOfAsync(string tenant, Guid employeeId, CancellationToken ct) =>
        await _sql.ScalarAsync("SELECT \"FirstName\" || ' ' || \"LastName\" FROM employee_employees WHERE \"TenantSlug\" = $1 AND \"Id\" = $2", ct, tenant, employeeId) as string;

    private async Task<(Guid Id, string Name)?> EmployeeByEmailAsync(string tenant, string email, CancellationToken ct)
    {
        var r = (await _sql.QueryAsync("""
            SELECT "Id", "FirstName" || ' ' || "LastName" FROM employee_employees
            WHERE "TenantSlug" = $1 AND lower("Email") = lower($2) AND "Status" <> 'Terminated' LIMIT 1
            """, r => (r.GetGuid(0), r.GetString(1)), ct, tenant, email.Trim())).FirstOrDefault();
        return r.Item1 == Guid.Empty ? null : r;
    }

    // ------------------------------------------------------------------ kimlik eşleştirme

    /// <summary>Slack kullanıcısını (e-postasıyla) çalışana bağlar; DM kanalını açar.</summary>
    public async Task<ChatIdentity> EnsureSlackIdentityAsync(GovernanceDbContext db, ChatApp app, string slackUserId, CancellationToken ct)
    {
        var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.ExternalUserId == slackUserId, ct);
        var token = SecretBox.Unprotect(app.SlackBotTokenEnc)!;
        if (id is null)
        {
            var (email, name) = await _slack.UserInfoAsync(token, slackUserId, ct);
            id = new ChatIdentity { TenantSlug = app.TenantSlug, AppId = app.Id, Platform = "Slack", ExternalUserId = slackUserId, Email = email, DisplayName = name };
            db.ChatIdentities.Add(id);
        }
        if (id.EmployeeId is null && id.Email is not null)
            id.EmployeeId = (await EmployeeByEmailAsync(app.TenantSlug, id.Email, ct))?.Id;
        id.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return id;
    }

    /// <summary>Çalışanın Slack hesabını e-postayla bulur (gerekirse) ve DM kanalını döndürür.</summary>
    private async Task<ChatIdentity?> SlackIdentityForEmployeeAsync(GovernanceDbContext db, ChatApp app, Guid employeeId, string? email, CancellationToken ct)
    {
        var token = SecretBox.Unprotect(app.SlackBotTokenEnc)!;
        var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.EmployeeId == employeeId, ct);
        if (id is null)
        {
            email ??= await _sql.ScalarAsync("SELECT \"Email\" FROM employee_employees WHERE \"TenantSlug\" = $1 AND \"Id\" = $2", ct, app.TenantSlug, employeeId) as string;
            if (string.IsNullOrWhiteSpace(email)) return null;
            var userId = await _slack.LookupByEmailAsync(token, email, ct);
            if (userId is null) return null;
            id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.ExternalUserId == userId, ct);
            if (id is null)
            {
                id = new ChatIdentity { TenantSlug = app.TenantSlug, AppId = app.Id, Platform = "Slack", ExternalUserId = userId, Email = email };
                db.ChatIdentities.Add(id);
            }
            id.EmployeeId = employeeId;
        }
        id.ConversationId ??= await _slack.OpenDmAsync(token, id.ExternalUserId, ct);
        return id;
    }

    /// <summary>
    /// Teams kullanıcısını kaydeder. Teams'te bot bir kişiye ancak o kişi botu
    /// ekledikten (ya da yazdıktan) sonra mesaj atabilir; konuşma bilgisi burada saklanır.
    /// </summary>
    public async Task<ChatIdentity> EnsureTeamsIdentityAsync(GovernanceDbContext db, ChatApp app, string userId, string? aadObjectId,
        string serviceUrl, string conversationId, bool personal, CancellationToken ct)
    {
        var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.ExternalUserId == userId, ct);
        if (id is null)
        {
            id = new ChatIdentity { TenantSlug = app.TenantSlug, AppId = app.Id, Platform = "Teams", ExternalUserId = userId };
            db.ChatIdentities.Add(id);
        }
        if (personal) { id.ConversationId = conversationId; id.ServiceUrl = serviceUrl; }
        if (id.Email is null)
        {
            try
            {
                var token = await TeamsTokenAsync(app, ct);
                var (email, name, _) = await _teams.MemberAsync(token, serviceUrl, conversationId, userId, ct);
                id.Email = email; id.DisplayName = name;
            }
            catch (ChatApiException ex) { _log.LogInformation("Teams üye bilgisi alınamadı: {Message}", ex.Message); }
        }
        if (id.EmployeeId is null && id.Email is not null)
            id.EmployeeId = (await EmployeeByEmailAsync(app.TenantSlug, id.Email, ct))?.Id;
        id.LastSeenAt = DateTime.UtcNow;
        await db.SaveChangesAsync(ct);
        return id;
    }

    public Task<string> TeamsTokenAsync(ChatApp app, CancellationToken ct) =>
        _teams.TokenAsync(app.TeamsAppId!, SecretBox.Unprotect(app.TeamsAppPasswordEnc)!, app.TeamsAzureTenantId!, ct);

    // ------------------------------------------------------------------ gönderim

    private async Task SendApprovalAsync(GovernanceDbContext db, ChatApp app, Guid approverId, string? approverEmail, PendingApproval p, CancellationToken ct)
    {
        if (await db.ChatMessages.AnyAsync(m => m.AppId == app.Id && m.StepId == p.StepId && m.RecipientEmployeeId == approverId, ct)) return;
        p = Shape(app, p);
        if (app.Platform == "Slack")
        {
            var id = await SlackIdentityForEmployeeAsync(db, app, approverId, approverEmail, ct);
            if (id?.ConversationId is null) return;
            if (!Trusted(app, id))
            {
                // Doğrulanmamış hesaba talep içeriği gönderilmez; yalnızca bağlama bağlantısı.
                var prompt = LinkPrompt(await LinkUrlAsync(db, id, TimeSpan.FromHours(24), ct), forApproval: true);
                await _slack.PostAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, id.ConversationId, prompt, ChatFormat.SlackText(prompt, null), ct);
                return;
            }
            var ts = await _slack.PostAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, id.ConversationId,
                ChatFormat.ApprovalFallback(p), ChatFormat.SlackApproval(p, null), ct);
            db.ChatMessages.Add(new ChatMessage { TenantSlug = app.TenantSlug, AppId = app.Id, Platform = "Slack", WorkflowRequestId = p.WorkflowId,
                StepId = p.StepId, RecipientEmployeeId = approverId, ConversationId = id.ConversationId, MessageId = ts, Subject = p.Subject });
        }
        else
        {
            var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.EmployeeId == approverId && i.ConversationId != null, ct);
            if (id is null) return; // kişi botu henüz eklemedi
            var token = await TeamsTokenAsync(app, ct);
            if (!Trusted(app, id))
            {
                var prompt = LinkPrompt(await LinkUrlAsync(db, id, TimeSpan.FromHours(24), ct), forApproval: true);
                await _teams.PostActivityAsync(token, id.ServiceUrl!, id.ConversationId!, ChatFormat.TeamsActivity(ChatFormat.TeamsTextCard(prompt, null), prompt), ct);
                return;
            }
            var activityId = await _teams.PostActivityAsync(token, id.ServiceUrl!, id.ConversationId!, ChatFormat.TeamsActivity(ChatFormat.TeamsApprovalCard(p, null), ChatFormat.ApprovalFallback(p)), ct);
            db.ChatMessages.Add(new ChatMessage { TenantSlug = app.TenantSlug, AppId = app.Id, Platform = "Teams", WorkflowRequestId = p.WorkflowId,
                StepId = p.StepId, RecipientEmployeeId = approverId, ConversationId = id.ConversationId!, ServiceUrl = id.ServiceUrl, MessageId = activityId ?? "", Subject = p.Subject });
        }
        app.LastActivityAt = DateTime.UtcNow;
        app.LastError = null;
    }

    /// <summary>Çalışana düz metin mesajı (sonuç bildirimi, deneme mesajı). Eşleşme yoksa false.</summary>
    public async Task<bool> SendTextToEmployeeAsync(GovernanceDbContext db, ChatApp app, Guid employeeId, string text, string? link, CancellationToken ct)
    {
        if (app.Platform == "Slack")
        {
            var id = await SlackIdentityForEmployeeAsync(db, app, employeeId, null, ct);
            if (id?.ConversationId is null || !Trusted(app, id)) return false;
            await _slack.PostAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, id.ConversationId, text, ChatFormat.SlackText(text, link), ct);
        }
        else
        {
            var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.EmployeeId == employeeId && i.ConversationId != null, ct);
            if (id is null || !Trusted(app, id)) return false;
            var token = await TeamsTokenAsync(app, ct);
            await _teams.PostActivityAsync(token, id.ServiceUrl!, id.ConversationId!, ChatFormat.TeamsActivity(ChatFormat.TeamsTextCard(text, link), text), ct);
        }
        app.LastActivityAt = DateTime.UtcNow;
        return true;
    }

    /// <summary>Açık onay mesajlarının düğmelerini kaldırıp durum satırı ekler.</summary>
    private async Task CloseMessagesAsync(GovernanceDbContext db, List<ChatApp> apps, string tenant, Guid wfId, Guid? keepStep, string status, CancellationToken ct)
    {
        var open = await db.ChatMessages.Where(m => m.TenantSlug == tenant && m.WorkflowRequestId == wfId && m.State == "Open"
            && (keepStep == null || m.StepId != keepStep)).ToListAsync(ct);
        foreach (var m in open)
        {
            var app = apps.FirstOrDefault(a => a.Id == m.AppId);
            m.State = keepStep is null ? "Decided" : "Closed";
            m.UpdatedAt = DateTime.UtcNow;
            if (app is null) continue;
            try { await UpdateMessageAsync(app, m, status, ct); }
            catch (Exception ex) when (ex is not OperationCanceledException) { await FailAsync(db, app, ex, ct); }
        }
    }

    public async Task UpdateMessageAsync(ChatApp app, ChatMessage m, string status, CancellationToken ct)
    {
        var p = new PendingApproval(m.WorkflowRequestId, m.StepId, "", m.Subject, null, null, null);
        var full = (await _sql.QueryAsync("""
            SELECT w."Id", $3::uuid, w."Type", w."Subject", e."FirstName" || ' ' || e."LastName", w."SlaDueAt", w."Payload"
            FROM workflow_requests w LEFT JOIN employee_employees e ON e."Id" = w."RequesterEmployeeId"
            WHERE w."TenantSlug" = $1 AND w."Id" = $2
            """, MapPending, ct, app.TenantSlug, m.WorkflowRequestId, m.StepId)).FirstOrDefault() ?? p;
        full = Shape(app, full);
        if (m.Platform == "Slack")
            await _slack.UpdateAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, m.ConversationId, m.MessageId, ChatFormat.StatusFallback(status, full), ChatFormat.SlackApproval(full, status), ct);
        else if (!string.IsNullOrEmpty(m.MessageId) && m.ServiceUrl is not null)
        {
            var token = await TeamsTokenAsync(app, ct);
            var activity = ChatFormat.TeamsActivity(ChatFormat.TeamsApprovalCard(full, status), ChatFormat.StatusFallback(status, full));
            activity["id"] = m.MessageId;
            await _teams.UpdateActivityAsync(token, m.ServiceUrl, m.ConversationId, m.MessageId, activity, ct);
        }
    }

    // ------------------------------------------------------------------ karar

    public sealed record DecisionResult(bool Ok, string Message, string? Status);

    /// <summary>Sohbetten gelen "Onayla/Reddet". Yetki kontrolü workflow-service'tedir.</summary>
    public async Task<DecisionResult> DecideAsync(GovernanceDbContext db, ChatApp app, ChatIdentity who, Guid wfId, Guid stepId, bool approve, CancellationToken ct)
    {
        if (!await EnsureActiveAsync(db, who, ct))
            return new(false, $"Sohbet hesabınız ({who.Email ?? "e-posta yok"}) HR360'taki etkin bir çalışan kaydıyla eşleşmedi. İK'dan e-posta adresinizi kontrol etmesini isteyin.", null);
        if (!Trusted(app, who))
            return new(false, LinkPrompt(await LinkUrlAsync(db, who, TimeSpan.FromHours(24), ct)), null);
        var token = Environment.GetEnvironmentVariable("INTERNAL_SERVICE_TOKEN");
        if (string.IsNullOrEmpty(token)) return new(false, "Sunucuda INTERNAL_SERVICE_TOKEN tanımlı değil; sohbetten onay kapalı.", null);

        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(10);
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{WorkflowBase}/api/internal/workflows/{wfId}/steps/{stepId}/decide")
        {
            Content = JsonContent.Create(new { tenantSlug = app.TenantSlug, actorEmployeeId = who.EmployeeId, decision = approve ? "Approved" : "Rejected", channel = app.Platform }),
        };
        req.Headers.Add("X-Internal-Token", token);
        using var res = await client.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        string? Msg() { try { return JsonDocument.Parse(body).RootElement.GetProperty("message").GetString(); } catch { return null; } }
        string? Status() { try { return JsonDocument.Parse(body).RootElement.GetProperty("status").GetString(); } catch { return null; } }

        if (res.IsSuccessStatusCode)
        {
            var status = approve ? "✅ Onayladınız" : "⛔ Reddettiniz";
            var mine = await db.ChatMessages.Where(m => m.AppId == app.Id && m.StepId == stepId && m.State == "Open").ToListAsync(ct);
            foreach (var m in mine)
            {
                m.State = "Decided"; m.UpdatedAt = DateTime.UtcNow;
                try { await UpdateMessageAsync(app, m, $"{status} · {DateTime.UtcNow.AddHours(3):dd.MM HH:mm}", ct); }
                catch (Exception ex) when (ex is not OperationCanceledException) { _log.LogInformation("Mesaj güncellenemedi: {Message}", ex.Message); }
            }
            app.LastActivityAt = DateTime.UtcNow;
            await db.SaveChangesAsync(ct);
            return new(true, approve ? "Talep onaylandı." : "Talep reddedildi.", Status());
        }
        return (int)res.StatusCode switch
        {
            409 => new(false, Msg() ?? "Bu talep zaten karara bağlanmış.", Status()),
            403 => new(false, Msg() ?? "Bu talebi karara bağlama yetkiniz yok.", null),
            404 => new(false, Msg() ?? "Talep bulunamadı.", null),
            _ => new(false, $"Karar kaydedilemedi (HTTP {(int)res.StatusCode}). HR360 üzerinden deneyin.", null),
        };
    }

    // ------------------------------------------------------------------ komutlar

    public const string Help = "Komutlar: *onaylarım* (bekleyen onaylarınız) · *bakiye* (izin bakiyeniz) · *izindekiler* · *kimnerede* · *bekleyen* · *ben*";

    public async Task<ChatReply> CommandAsync(GovernanceDbContext db, ChatApp app, ChatIdentity who, string? input, CancellationToken ct)
    {
        var tenant = who.TenantSlug;
        var cmd = Normalize(input);
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        ChatReply T(string t) => new(t, Array.Empty<PendingApproval>());
        const string notLinked = "Hesabınız bir çalışan kaydıyla eşleşmedi; bu komut için eşleşme gerekir. *ben* yazarak durumu görebilirsiniz.";

        // Her istekte: çalışan hâlâ etkin mi (ayrılanın erişimi anında kapanır), hesap doğrulandı mı.
        var active = await EnsureActiveAsync(db, who, ct);
        var known = cmd is "" or "yardim" or "help" or "ben" or "kimim" or "bagla";
        if (!known && active && !Trusted(app, who))
            return T(LinkPrompt(await LinkUrlAsync(db, who, TimeSpan.FromHours(24), ct)));

        switch (cmd)
        {
            case "onaylarim" or "onay" or "onaylar":
                if (who.EmployeeId is null) return T(notLinked);
                var items = (await MyPendingAsync(tenant, who.EmployeeId.Value, 5, ct)).Select(p => Shape(app, p)).ToList();
                var total = items.Count < 5 ? items.Count : await MyPendingCountAsync(tenant, who.EmployeeId.Value, ct);
                if (items.Count == 0) return T("Karar bekleyen talebiniz yok. 🎉");
                return new(total > items.Count
                    ? $"Karar bekleyen *{total}* talebiniz var; en yeni {items.Count} tanesi aşağıda. Tümü: {PublicOrigin}/panel/onaylar"
                    : $"Karar bekleyen *{items.Count}* talebiniz var:", items);

            case "bakiye" or "izinbakiyem" or "izin":
                if (who.EmployeeId is null) return T(notLinked);
                var rows = await _sql.QueryAsync("""
                    SELECT "Type", "EntitledDays", "UsedDays", "PendingDays" FROM leave_balances
                    WHERE "TenantSlug" = $1 AND "EmployeeId" = $2 AND "Year" = $3 ORDER BY "Type"
                    """, r => (Type: r.GetString(0), E: r.GetDecimal(1), U: r.GetDecimal(2), P: r.GetDecimal(3)), ct, tenant, who.EmployeeId.Value, today.Year);
                if (rows.Count == 0) return T($"{today.Year} için tanımlı izin bakiyeniz yok.");
                return T($"*{today.Year} izin bakiyeniz*\n" + string.Join("\n", rows.Select(b =>
                    $"• {LeaveLabel(b.Type)}: *{b.E - b.U - b.P:0.#}* gün kaldı (hak {b.E:0.#}, kullanılan {b.U:0.#}{(b.P > 0 ? $", onay bekleyen {b.P:0.#}" : "")})")));

            case "izindekiler" or "izinde":
            {
                if (who.EmployeeId is null) return T(notLinked);
                // KVKK veri en aza indirme: adlar yalnızca yöneticiye ve yalnızca kendi ekibi için;
                // diğer çalışanlara toplam sayı. İzin türü hiçbir zaman yazılmaz.
                var onLeave = await _sql.QueryAsync("""
                    SELECT l."EmployeeId", e."FirstName" || ' ' || e."LastName", l."EndDate" FROM leave_requests l JOIN employee_employees e ON e."Id" = l."EmployeeId"
                    WHERE l."TenantSlug" = $1 AND l."Status" = 'Approved' AND l."StartDate" <= $2 AND l."EndDate" >= $2 ORDER BY 2
                    """, r => (Id: r.GetGuid(0), Name: r.GetString(1), End: r.GetFieldValue<DateOnly>(2)), ct, tenant, today);
                var team = (await _people.TeamOfAsync(tenant, who.EmployeeId.Value, ct)).Select(p => p.Id).ToHashSet();
                if (team.Count == 0)
                    return T(onLeave.Count == 0 ? "Bugün izinde olan kimse yok." : $"Bugün şirkette *{onLeave.Count}* kişi izinde.");
                var mine = onLeave.Where(x => team.Contains(x.Id)).Select(x => $"• {x.Name} ({x.End:dd.MM}'e kadar)").ToList();
                return T((mine.Count == 0 ? "Bugün ekibinizden izinde olan yok." : $"*Ekibinizden bugün izinde ({mine.Count}):*\n" + string.Join("\n", mine))
                    + (onLeave.Count > mine.Count ? $"\nŞirket genelinde toplam {onLeave.Count} kişi izinde." : ""));
            }

            case "kimnerede":
                var modes = await _sql.QueryAsync("SELECT \"Mode\", count(*) FROM engagement_presence WHERE \"TenantSlug\" = $1 AND \"Date\" = $2 GROUP BY 1",
                    r => (Mode: r.GetString(0), N: r.GetInt64(1)), ct, tenant, today);
                static string L(string m) => m switch { "Office" => "Ofiste", "Remote" => "Uzaktan", "Travel" => "Seyahatte", "Off" => "Çalışmıyor", _ => m };
                return T(modes.Count == 0 ? "Bugün için çalışma yeri bildiren olmadı." : "*Bugün:* " + string.Join(" · ", modes.Select(m => $"{L(m.Mode)} {m.N}")));

            case "bekleyen":
                var pending = Convert.ToInt64(await _sql.ScalarAsync("SELECT count(*) FROM workflow_requests WHERE \"TenantSlug\" = $1 AND \"Status\" = 'Pending'", ct, tenant));
                return T($"Şirkette onay bekleyen *{pending}* talep var.");

            case "ben" or "kimim" or "bagla":
                if (who.EmployeeId is null)
                    return T($"Hesabınız ({who.Email ?? "e-posta görünmüyor"}) henüz bir çalışan kaydıyla eşleşmedi. Eşleşme e-posta adresiyle yapılır; HR360'taki e-postanız sohbet hesabınızla aynı olmalı.");
                if (!Trusted(app, who))
                    return T(LinkPrompt(await LinkUrlAsync(db, who, TimeSpan.FromHours(24), ct)));
                return T($"Hesabınız *{await NameOfAsync(tenant, who.EmployeeId.Value, ct)}* ({who.Email}) ile bağlı. Onay talepleri size buradan gelecek.");

            default:
                return T((string.IsNullOrEmpty(cmd) ? "" : "Bu komutu tanımadım. ") + Help);
        }
    }

    private static string Normalize(string? s)
    {
        s = (s ?? "").Trim().ToLower(Tr);
        // Teams'te bot adıyla başlayan mesajlar (@HR360 bakiye) ve Türkçe karakterler.
        s = System.Text.RegularExpressions.Regex.Replace(s, "<at>.*?</at>", "").Trim();
        s = s.Replace('ı', 'i').Replace('ğ', 'g').Replace('ü', 'u').Replace('ş', 's').Replace('ö', 'o').Replace('ç', 'c');
        s = new string(s.Where(c => char.IsLetterOrDigit(c) || c == ' ').ToArray()).Trim();
        return s.Replace(" ", "");
    }
}


/// <summary>Sohbet gönderim kuyruğunu periyodik olarak işler.</summary>
public sealed class ChatOutboxWorker(IServiceProvider sp, ILogger<ChatOutboxWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        var period = TimeSpan.FromSeconds(Math.Clamp(ChatService.RetryBaseSeconds / 2, 1, 30));
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var scope = sp.CreateScope();
                scope.ServiceProvider.GetRequiredService<TenantContext>().IsPlatformAdmin = true;
                var db = scope.ServiceProvider.GetRequiredService<GovernanceDbContext>();
                await scope.ServiceProvider.GetRequiredService<ChatService>().ProcessOutboxAsync(db, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException) { log.LogWarning(ex, "Sohbet kuyruğu işlenemedi"); }
            await Task.Delay(period, ct);
        }
    }
}
