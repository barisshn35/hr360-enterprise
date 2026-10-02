using System.Text.Json;
using GovernanceService.Tenancy;

namespace GovernanceService.Models;

/// <summary>Kafka'dan gelen her olayın kopyası (canlı radar + kural/webhook kaynağı). 30 gün tutulur.</summary>
public class GovernanceEvent
{
    public Guid Id { get; set; }
    public string? TenantSlug { get; set; }
    public string Topic { get; set; } = "";
    public string EventType { get; set; } = "";
    public JsonDocument? Payload { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

/* ================================================================== KVKK */

public class Consent : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string UserId { get; set; } = "";
    public Guid? EmployeeId { get; set; }
    public string PersonName { get; set; } = "";
    public string ConsentType { get; set; } = "";
    public string Version { get; set; } = "";
    public bool Granted { get; set; }
    public string? IpAddress { get; set; }
    public DateTime RecordedAt { get; set; } = DateTime.UtcNow;
}

public class DataRequest : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string UserId { get; set; } = "";
    public Guid? EmployeeId { get; set; }
    public string PersonName { get; set; } = "";
    /// <summary>Access | Rectification | Erasure | Objection</summary>
    public string Kind { get; set; } = "Access";
    public string? Details { get; set; }
    /// <summary>Received | InProgress | Completed | Rejected</summary>
    public string Status { get; set; } = "Received";
    public string? Response { get; set; }
    /// <summary>KVKK m.13: en geç 30 gün içinde yanıt.</summary>
    public DateTime DueAt { get; set; } = DateTime.UtcNow.AddDays(30);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}

public class RetentionPolicy : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    /// <summary>RejectedCandidates | TerminatedEmployees | AuditLog | Notifications</summary>
    public string Category { get; set; } = "";
    public int RetentionMonths { get; set; }
    /// <summary>Anonymize | Delete</summary>
    public string Action { get; set; } = "Anonymize";
    public bool IsEnabled { get; set; }
    public DateTime? LastRunAt { get; set; }
    public int LastAffected { get; set; }
}

/* ======================================================= Belge şablonları */

public class DocTemplate : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Category { get; set; } = "Genel";
    /// <summary>{{calisan.ad}} gibi yer tutucular içeren HTML/metin.</summary>
    public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/* ========================================================== Kural motoru */

public class RuleCondition
{
    /// <summary>Olay yükündeki alan (ör. "Days", "WorkflowType", "NewStatus").</summary>
    public string Field { get; set; } = "";
    /// <summary>eq | neq | gt | gte | lt | lte | contains</summary>
    public string Op { get; set; } = "eq";
    public string Value { get; set; } = "";
}

public class RuleAction
{
    /// <summary>notify | webhook | slack | teams</summary>
    public string Type { get; set; } = "notify";
    /// <summary>notify: çalışan id'si veya "requester"/"approver"/"hr"; webhook/slack/teams: URL (boşsa tanımlı entegrasyonlar).</summary>
    public string? Target { get; set; }
    /// <summary>{{alan}} yer tutuculu mesaj.</summary>
    public string Message { get; set; } = "";
}

public class Rule : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>Olay tipi (ör. "leave.approved") veya "*".</summary>
    public string Trigger { get; set; } = "";
    public List<RuleCondition> Conditions { get; set; } = new();
    public List<RuleAction> Actions { get; set; } = new();
    public bool IsEnabled { get; set; } = true;
    public int FireCount { get; set; }
    public DateTime? LastFiredAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class RuleRun : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid RuleId { get; set; }
    public string RuleName { get; set; } = "";
    public string EventType { get; set; } = "";
    public string Result { get; set; } = "";
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

/* ============================================== Webhook, API anahtarı, entegrasyon */

public class Webhook : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    /// <summary>HMAC-SHA256 imza anahtarı (X-HR360-Signature).</summary>
    public string Secret { get; set; } = "";
    public List<string> Events { get; set; } = new();
    public bool IsEnabled { get; set; } = true;
    public int? LastStatus { get; set; }
    public DateTime? LastDeliveredAt { get; set; }
    public int FailureCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class WebhookDelivery : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid WebhookId { get; set; }
    public string EventType { get; set; } = "";
    public int? StatusCode { get; set; }
    public string? Error { get; set; }
    public int DurationMs { get; set; }
    public DateTime OccurredAt { get; set; } = DateTime.UtcNow;
}

public class ApiKey : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Name { get; set; } = "";
    public string Prefix { get; set; } = "";
    public string KeyHash { get; set; } = "";
    public List<string> Scopes { get; set; } = new();
    public string? CreatedByName { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAt { get; set; }
    public DateTime? RevokedAt { get; set; }
}

public class Integration : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    /// <summary>Slack | Teams</summary>
    public string Kind { get; set; } = "Slack";
    public string Name { get; set; } = "";
    public string WebhookUrl { get; set; } = "";
    public List<string> Events { get; set; } = new();
    /// <summary>Slack slash komutu imza doğrulaması için (isteğe bağlı).</summary>
    public string? SigningSecret { get; set; }
    public bool IsEnabled { get; set; } = true;
    public int? LastStatus { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/* ============================================================ Faturalama */

public class Invoice : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Number { get; set; } = "";
    public string Period { get; set; } = "";
    public string Plan { get; set; } = "";
    public int Seats { get; set; }
    public decimal UnitPrice { get; set; }
    public decimal Amount { get; set; }
    public decimal TaxAmount { get; set; }
    public decimal Total { get; set; }
    public string Currency { get; set; } = "TRY";
    /// <summary>Issued | Paid | Void</summary>
    public string Status { get; set; } = "Issued";
    public DateTime IssuedAt { get; set; } = DateTime.UtcNow;
    public DateTime DueAt { get; set; } = DateTime.UtcNow.AddDays(15);
    public DateTime? PaidAt { get; set; }
    public string? PaymentRef { get; set; }
}

/* ======================================================== Takvim + bilgi bankası */

public class CalendarFeed : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string UserId { get; set; } = "";
    public Guid? EmployeeId { get; set; }
    public string Token { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class KbArticle : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public string Title { get; set; } = "";
    public string Body { get; set; } = "";
    public List<string> Tags { get; set; } = new();
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/* ============================================================ Sohbet uygulamaları (Slack / Teams botu) */

/// <summary>
/// Kiracının Slack uygulaması ya da Microsoft Teams botu. Gelen webhook'tan
/// (governance_integrations) farkı: kişiye özel mesaj, onay düğmeleri ve komutlar.
/// Sırlar SecretBox ile şifreli tutulur.
/// </summary>
public class ChatApp : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    /// <summary>Slack | Teams</summary>
    public string Platform { get; set; } = "Slack";
    public string Name { get; set; } = "";
    public bool IsEnabled { get; set; } = true;
    public bool NotifyApprovals { get; set; } = true;
    public bool NotifyRequesters { get; set; } = true;
    // Slack
    public string? SlackTeamId { get; set; }
    public string? SlackTeamName { get; set; }
    public string? SlackBotUserId { get; set; }
    public string? SlackBotTokenEnc { get; set; }
    public string? SlackSigningSecretEnc { get; set; }
    // Teams (Azure Bot, tek kiracılı)
    public string? TeamsAppId { get; set; }
    public string? TeamsAppPasswordEnc { get; set; }
    public string? TeamsAzureTenantId { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastActivityAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Sohbet hesabı ↔ çalışan eşleşmesi (e-posta ile kurulur).</summary>
public class ChatIdentity : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid AppId { get; set; }
    public string Platform { get; set; } = "Slack";
    public string ExternalUserId { get; set; } = "";
    public Guid? EmployeeId { get; set; }
    public string? Email { get; set; }
    public string? DisplayName { get; set; }
    /// <summary>Slack: DM kanal kimliği. Teams: 1:1 konuşma kimliği.</summary>
    public string? ConversationId { get; set; }
    /// <summary>Teams: Bot Connector adresi (konuşmaya özel).</summary>
    public string? ServiceUrl { get; set; }
    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastSeenAt { get; set; }
}

/// <summary>Gönderilen onay mesajı; karar verilince mesaj güncellenir.</summary>
public class ChatMessage : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid AppId { get; set; }
    public string Platform { get; set; } = "Slack";
    public Guid WorkflowRequestId { get; set; }
    public Guid StepId { get; set; }
    public Guid RecipientEmployeeId { get; set; }
    public string ConversationId { get; set; } = "";
    public string MessageId { get; set; } = "";
    public string? ServiceUrl { get; set; }
    /// <summary>Open | Decided | Closed</summary>
    public string State { get; set; } = "Open";
    public string? Subject { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

/* ============================================================ Takvim ve toplantı entegrasyonu */

/// <summary>Kiracının Google / Microsoft 365 / Zoom uygulama bilgileri (OAuth istemcisi).</summary>
public class ProviderConfig : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    /// <summary>Google | Microsoft | Zoom</summary>
    public string Provider { get; set; } = "";
    public string ClientId { get; set; } = "";
    public string? ClientSecretEnc { get; set; }
    /// <summary>Microsoft: Entra ID kiracı kimliği ya da "organizations".</summary>
    public string? MsTenant { get; set; }
    /// <summary>Zoom: Server-to-Server OAuth hesap kimliği.</summary>
    public string? ZoomAccountId { get; set; }
    /// <summary>Zoom: düzenleyicinin Zoom hesabı yoksa toplantının açılacağı kullanıcı.</summary>
    public string? ZoomDefaultHost { get; set; }
    public bool IsEnabled { get; set; } = true;
    public string? LastError { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Bir çalışanın bağladığı Google / Outlook takvimi.</summary>
public class CalendarConnection : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid EmployeeId { get; set; }
    public string UserId { get; set; } = "";
    /// <summary>Google | Microsoft</summary>
    public string Provider { get; set; } = "";
    public string? AccountEmail { get; set; }
    public string? AccessTokenEnc { get; set; }
    public string? RefreshTokenEnc { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public bool SyncLeaves { get; set; } = true;
    /// <summary>Active | Error</summary>
    public string Status { get; set; } = "Active";
    public string? LastError { get; set; }
    public DateTime? LastSyncAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Bekleyen OAuth yetkilendirmesi (state + PKCE doğrulayıcısı), 10 dk geçerli.</summary>
public class OAuthState : ITenantOwned
{
    public string State { get; set; } = "";
    public string TenantSlug { get; set; } = "";
    public Guid EmployeeId { get; set; }
    public string UserId { get; set; } = "";
    public string Provider { get; set; } = "";
    public string CodeVerifier { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
}

/// <summary>HR360 kaydı ↔ dış takvimdeki etkinlik (silme/güncelleme için).</summary>
public class CalendarEventLink : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public Guid ConnectionId { get; set; }
    /// <summary>leave | meeting</summary>
    public string SourceType { get; set; } = "";
    public Guid SourceId { get; set; }
    public string ExternalEventId { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>1:1, mülakat ya da serbest toplantı; Zoom / Teams / Google Meet bağlantısıyla.</summary>
public class Meeting : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    /// <summary>one-on-one | interview | custom</summary>
    public string SourceType { get; set; } = "custom";
    public Guid? SourceId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public DateTime StartsAt { get; set; }
    public int DurationMinutes { get; set; } = 30;
    /// <summary>zoom | teams | google | none</summary>
    public string Provider { get; set; } = "none";
    public string? JoinUrl { get; set; }
    public string? ExternalMeetingId { get; set; }
    public Guid OrganizerEmployeeId { get; set; }
    public List<Guid> ParticipantEmployeeIds { get; set; } = new();
    public List<string> ExternalEmails { get; set; } = new();
    /// <summary>Scheduled | Cancelled</summary>
    public string Status { get; set; } = "Scheduled";
    public string? Warnings { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

/* ============================================================ Yapay zekâ (LLM) */

/// <summary>Kiracının LLM kullanım izni. Varsayılan kapalı (KVKK: veri dışarı çıkabilir).</summary>
public class AiSettings : ITenantOwned
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string TenantSlug { get; set; } = "";
    public bool Enabled { get; set; }
    /// <summary>Performans özeti gibi kişisel veri içeren isteklere izin (ad yine takma adla gönderilir).</summary>
    public bool AllowPersonalData { get; set; }
    public string? UpdatedBy { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>LLM çağrı kaydı (içerik tutulmaz): hesap verebilirlik ve kota için.</summary>
public class AiUsage : ITenantOwned
{
    public long Id { get; set; }
    public string TenantSlug { get; set; } = "";
    public string? UserId { get; set; }
    public string Task { get; set; } = "";
    public string Provider { get; set; } = "";
    public string Model { get; set; } = "";
    public int InputTokens { get; set; }
    public int OutputTokens { get; set; }
    public int DurationMs { get; set; }
    public bool Success { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
}
