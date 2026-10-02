using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Models;

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

    public ChatService(Sql sql, SlackApi slack, TeamsApi teams, IHttpClientFactory http, ILogger<ChatService> log)
    { _sql = sql; _slack = slack; _teams = teams; _http = http; _log = log; }

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
                catch (Exception ex) when (ex is not OperationCanceledException) { await FailAsync(db, app, ex, ct); }
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
                catch (Exception ex) when (ex is not OperationCanceledException) { await FailAsync(db, app, ex, ct); }
            }
        }
        await db.SaveChangesAsync(ct);
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
        if (app.Platform == "Slack")
        {
            var id = await SlackIdentityForEmployeeAsync(db, app, approverId, approverEmail, ct);
            if (id?.ConversationId is null) return;
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
            if (id?.ConversationId is null) return false;
            await _slack.PostAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, id.ConversationId, text, ChatFormat.SlackText(text, link), ct);
        }
        else
        {
            var id = await db.ChatIdentities.FirstOrDefaultAsync(i => i.AppId == app.Id && i.EmployeeId == employeeId && i.ConversationId != null, ct);
            if (id is null) return false;
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
        if (m.Platform == "Slack")
            await _slack.UpdateAsync(SecretBox.Unprotect(app.SlackBotTokenEnc)!, m.ConversationId, m.MessageId, $"{status}: {full.Subject}", ChatFormat.SlackApproval(full, status), ct);
        else if (!string.IsNullOrEmpty(m.MessageId) && m.ServiceUrl is not null)
        {
            var token = await TeamsTokenAsync(app, ct);
            var activity = ChatFormat.TeamsActivity(ChatFormat.TeamsApprovalCard(full, status), $"{status}: {full.Subject}");
            activity["id"] = m.MessageId;
            await _teams.UpdateActivityAsync(token, m.ServiceUrl, m.ConversationId, m.MessageId, activity, ct);
        }
    }

    // ------------------------------------------------------------------ karar

    public sealed record DecisionResult(bool Ok, string Message, string? Status);

    /// <summary>Sohbetten gelen "Onayla/Reddet". Yetki kontrolü workflow-service'tedir.</summary>
    public async Task<DecisionResult> DecideAsync(GovernanceDbContext db, ChatApp app, ChatIdentity who, Guid wfId, Guid stepId, bool approve, CancellationToken ct)
    {
        if (who.EmployeeId is null)
            return new(false, $"Sohbet hesabınız ({who.Email ?? "e-posta yok"}) HR360'taki bir çalışan kaydıyla eşleşmedi. İK'dan e-posta adresinizi kontrol etmesini isteyin.", null);
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

    public async Task<ChatReply> CommandAsync(ChatIdentity who, string? input, CancellationToken ct)
    {
        var tenant = who.TenantSlug;
        var cmd = Normalize(input);
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        ChatReply T(string t) => new(t, Array.Empty<PendingApproval>());
        const string notLinked = "Hesabınız bir çalışan kaydıyla eşleşmedi; bu komut için eşleşme gerekir. *ben* yazarak durumu görebilirsiniz.";

        switch (cmd)
        {
            case "onaylarim" or "onay" or "onaylar":
                if (who.EmployeeId is null) return T(notLinked);
                var items = await MyPendingAsync(tenant, who.EmployeeId.Value, 5, ct);
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
                var onLeave = await _sql.QueryAsync("""
                    SELECT e."FirstName" || ' ' || e."LastName", l."EndDate" FROM leave_requests l JOIN employee_employees e ON e."Id" = l."EmployeeId"
                    WHERE l."TenantSlug" = $1 AND l."Status" = 'Approved' AND l."StartDate" <= $2 AND l."EndDate" >= $2 ORDER BY 1
                    """, r => $"• {r.GetString(0)} ({r.GetFieldValue<DateOnly>(1):dd.MM}'e kadar)", ct, tenant, today);
                return T(onLeave.Count == 0 ? "Bugün izinde olan kimse yok." : $"*Bugün izinde ({onLeave.Count}):*\n" + string.Join("\n", onLeave));

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
                return T($"Hesabınız *{await NameOfAsync(tenant, who.EmployeeId.Value, ct)}* ({who.Email}) ile eşleşti. Onay talepleri size buradan gelecek.");

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
