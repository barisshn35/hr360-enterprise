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
