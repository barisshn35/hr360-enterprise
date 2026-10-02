using System.Globalization;
using System.Text.Json.Nodes;

namespace GovernanceService.Infrastructure.Chat;

/// <summary>
/// Mesaj biçimleri: Slack Block Kit ve Teams Adaptive Card (1.4). Düğme değerleri
/// "talep|adım" biçimindedir; karar her zaman sunucuda yeniden yetkilendirilir.
/// </summary>
public static class ChatFormat
{
    private static readonly CultureInfo Tr = CultureInfo.GetCultureInfo("tr-TR");
    public const string ApproveAction = "hr360_approve";
    public const string RejectAction = "hr360_reject";

    private static string Title(PendingApproval p)
    {
        var label = ChatService.TypeLabel(p.Type);
        return $"{char.ToUpper(label[0], Tr)}{label[1..]} talebi onayınızı bekliyor";
    }

    private static string? Sla(PendingApproval p) =>
        p.SlaDueAt is { } d ? d.AddHours(3).ToString("d MMMM HH:mm", Tr) : null;

    public static string ApprovalFallback(PendingApproval p) =>
        $"{Title(p)}: {p.Requester ?? "Bir çalışan"} — {p.Subject}";

    /// <summary>Slack mrkdwn kaçışı (&amp; &lt; &gt;).</summary>
    private static string E(string? s) => (s ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;");

    public static JsonArray SlackApproval(PendingApproval p, string? status)
    {
        var lines = $"*{E(Title(p))}*\n*{E(p.Requester ?? "Bir çalışan")}* · {E(p.Subject)}";
        if (p.Details is not null) lines += $"\n{E(p.Details)}";
        var blocks = new JsonArray
        {
            new JsonObject { ["type"] = "section", ["text"] = new JsonObject { ["type"] = "mrkdwn", ["text"] = lines } },
        };
        var context = new List<string>();
        if (Sla(p) is { } sla && status is null) context.Add($"⏱ Son karar: {sla}");
        if (status is not null) context.Add(E(status));
        if (context.Count > 0)
            blocks.Add(new JsonObject { ["type"] = "context", ["elements"] = new JsonArray(context.Select(c => (JsonNode)new JsonObject { ["type"] = "mrkdwn", ["text"] = c }).ToArray()) });
        var value = $"{p.WorkflowId}|{p.StepId}";
        var elements = new JsonArray();
        if (status is null)
        {
            elements.Add(new JsonObject { ["type"] = "button", ["action_id"] = ApproveAction, ["style"] = "primary", ["value"] = value, ["text"] = PlainText("Onayla") });
            elements.Add(new JsonObject
            {
                ["type"] = "button", ["action_id"] = RejectAction, ["style"] = "danger", ["value"] = value, ["text"] = PlainText("Reddet"),
                ["confirm"] = new JsonObject
                {
                    ["title"] = PlainText("Talep reddedilsin mi?"),
                    ["text"] = new JsonObject { ["type"] = "mrkdwn", ["text"] = "Gerekçe eklemek isterseniz HR360'ta açıp oradan reddedin." },
                    ["confirm"] = PlainText("Reddet"), ["deny"] = PlainText("Vazgeç"), ["style"] = "danger",
                },
            });
        }
        elements.Add(new JsonObject { ["type"] = "button", ["action_id"] = "hr360_open", ["url"] = ChatService.WorkflowUrl(p.WorkflowId), ["text"] = PlainText("HR360'ta aç") });
        blocks.Add(new JsonObject { ["type"] = "actions", ["block_id"] = $"wf_{p.StepId:N}", ["elements"] = elements });
        return blocks;
    }

    private static JsonObject PlainText(string t) => new() { ["type"] = "plain_text", ["text"] = t, ["emoji"] = true };

    public static JsonArray SlackText(string text, string? link)
    {
        var blocks = new JsonArray { new JsonObject { ["type"] = "section", ["text"] = new JsonObject { ["type"] = "mrkdwn", ["text"] = text } } };
        if (link is not null)
            blocks.Add(new JsonObject { ["type"] = "actions", ["elements"] = new JsonArray { new JsonObject { ["type"] = "button", ["action_id"] = "hr360_open", ["url"] = link, ["text"] = PlainText("HR360'ta aç") } } });
        return blocks;
    }

    /// <summary>Komut yanıtı: metin + her bekleyen onay için ayrı düğme bloğu.</summary>
    public static JsonArray SlackReply(ChatReply reply)
    {
        var blocks = SlackText(reply.Text, null);
        foreach (var p in reply.Approvals)
        {
            blocks.Add(new JsonObject { ["type"] = "divider" });
            foreach (var b in SlackApproval(p, null)) blocks.Add(b!.DeepClone());
        }
        return blocks;
    }

    // ------------------------------------------------------------------ Teams

    public static JsonObject TeamsActivity(JsonObject card, string fallback) => new()
    {
        ["type"] = "message",
        ["summary"] = fallback,
        ["attachments"] = new JsonArray { new JsonObject { ["contentType"] = "application/vnd.microsoft.card.adaptive", ["content"] = card } },
    };

    private static JsonObject Card(JsonArray body, JsonArray? actions = null)
    {
        var card = new JsonObject
        {
            ["$schema"] = "http://adaptivecards.io/schemas/adaptive-card.json",
            ["type"] = "AdaptiveCard", ["version"] = "1.4", ["body"] = body,
        };
        if (actions is { Count: > 0 }) card["actions"] = actions;
        return card;
    }

    private static JsonObject Text(string text, bool bold = false, string? color = null, bool subtle = false)
    {
        var o = new JsonObject { ["type"] = "TextBlock", ["text"] = text, ["wrap"] = true };
        if (bold) o["weight"] = "Bolder";
        if (color is not null) o["color"] = color;
        if (subtle) o["isSubtle"] = true;
        return o;
    }

    public static JsonObject TeamsApprovalCard(PendingApproval p, string? status)
    {
        var facts = new JsonArray
        {
            new JsonObject { ["title"] = "Talep eden", ["value"] = p.Requester ?? "—" },
            new JsonObject { ["title"] = "Konu", ["value"] = p.Subject ?? "—" },
        };
        if (p.Details is not null) facts.Add(new JsonObject { ["title"] = "Ayrıntı", ["value"] = p.Details });
        if (Sla(p) is { } sla && status is null) facts.Add(new JsonObject { ["title"] = "Son karar", ["value"] = sla });
        var body = new JsonArray { Text(Title(p), bold: true), new JsonObject { ["type"] = "FactSet", ["facts"] = facts } };
        if (status is not null) body.Add(Text(status, bold: true, color: status.StartsWith('⛔') ? "Attention" : "Good"));
        var actions = new JsonArray();
        if (status is null)
        {
            actions.Add(new JsonObject { ["type"] = "Action.Submit", ["title"] = "Onayla", ["style"] = "positive",
                ["data"] = new JsonObject { ["hr360"] = "decide", ["decision"] = "approve", ["wf"] = p.WorkflowId.ToString(), ["step"] = p.StepId.ToString() } });
            actions.Add(new JsonObject { ["type"] = "Action.Submit", ["title"] = "Reddet", ["style"] = "destructive",
                ["data"] = new JsonObject { ["hr360"] = "decide", ["decision"] = "reject", ["wf"] = p.WorkflowId.ToString(), ["step"] = p.StepId.ToString() } });
        }
        actions.Add(new JsonObject { ["type"] = "Action.OpenUrl", ["title"] = "HR360'ta aç", ["url"] = ChatService.WorkflowUrl(p.WorkflowId) });
        return Card(body, actions);
    }

    /// <summary>Teams metni: Slack'in *kalın* biçimi **kalın**'a çevrilir.</summary>
    private static string Md(string s) => System.Text.RegularExpressions.Regex.Replace(s, @"(?<!\*)\*([^*\n]+)\*(?!\*)", "**$1**");

    public static JsonObject TeamsTextCard(string text, string? link)
    {
        var body = new JsonArray(Md(text).Split('\n').Select(l => (JsonNode)Text(l)).ToArray());
        var actions = link is null ? null : new JsonArray { new JsonObject { ["type"] = "Action.OpenUrl", ["title"] = "HR360'ta aç", ["url"] = link } };
        return Card(body, actions);
    }

    public static IEnumerable<JsonObject> TeamsReply(ChatReply reply)
    {
        yield return TeamsActivity(TeamsTextCard(reply.Text, null), reply.Text);
        foreach (var p in reply.Approvals)
            yield return TeamsActivity(TeamsApprovalCard(p, null), ApprovalFallback(p));
    }

    /// <summary>Gelen webhook (Teams Workflows / Power Automate) için kanal mesajı.</summary>
    public static JsonObject TeamsWebhookMessage(string text, string type) => new()
    {
        ["type"] = "message",
        ["attachments"] = new JsonArray
        {
            new JsonObject
            {
                ["contentType"] = "application/vnd.microsoft.card.adaptive",
                ["contentUrl"] = null,
                ["content"] = Card(new JsonArray { Text("HR360", bold: true), Text(text), Text(type, subtle: true) }),
            },
        },
    };
}
