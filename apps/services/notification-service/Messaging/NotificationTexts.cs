using System.Globalization;

namespace NotificationService.Messaging;

/// <summary>
/// Olay bildirimlerinin Türkçe ve İngilizce metinleri. Dil, alıcının tercihidir
/// (<see cref="Models.NotificationPreference"/>); tanımsızsa Türkçe.
/// </summary>
public static class NotificationTexts
{
    public static string Normalize(string? lang) => lang is "en" ? "en" : "tr";

    private static string D(DateOnly d, string lang) => lang == "en"
        ? d.ToString("d MMM yyyy", CultureInfo.GetCultureInfo("en-GB"))
        : d.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture);

    private static string Dt(DateTimeOffset d, string lang)
    {
        var local = d.ToOffset(TimeSpan.FromHours(3));
        return lang == "en"
            ? local.ToString("d MMM yyyy HH:mm", CultureInfo.GetCultureInfo("en-GB"))
            : local.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);
    }

    public static (string Subject, string Body) Hired(string lang, string first, string last, DateOnly hireDate) => lang == "en"
        ? ("Welcome to HR360",
           $"Hello {first} {last}, your start date of {D(hireDate, lang)} has been recorded. Your onboarding tasks are waiting for you in the Onboarding module.")
        : ("HR360'a hoş geldiniz",
           $"Merhaba {first} {last}, {D(hireDate, lang)} tarihli işe başlangıcınız sisteme kaydedildi. İşe uyum görevleriniz Onboarding modülünde sizi bekliyor.");

    public static (string Subject, string Body) Assigned(string lang, string first, DateOnly from, string? position) => lang == "en"
        ? ("Your department assignment was updated",
           $"Hello {first}, effective {D(from, lang)}, your new position is: {position ?? "(not specified)"}.")
        : ("Departman atamanız güncellendi",
           $"Merhaba {first}, {D(from, lang)} tarihinden geçerli olmak üzere yeni pozisyonunuz: {position ?? "(belirtilmemiş)"}.");

    /// <summary>
    /// Onaycıya giden e-posta. KVKK: talep konusu (ör. "3 günlük hastalık izni") e-postaya
    /// yazılmaz; yalnızca talep türü ve talep eden. Ayrıntı HR360'ta, giriş yapınca görülür.
    /// </summary>
    public static (string Subject, string Body) Submitted(string lang, string approverFirst, string? requester, string workflowType,
        DateTimeOffset? sla, bool escalated = false, bool delegated = false, bool hasLink = false)
    {
        var en = lang == "en";
        var type = TypeLabel(workflowType, en);
        var who = string.IsNullOrWhiteSpace(requester) ? (en ? "an employee" : "Bir çalışan") : requester;
        var why = escalated
            ? (en ? " It was forwarded to you because the decision deadline passed." : " Karar süresi aşıldığı için size iletildi.")
            : delegated ? (en ? " You are deciding as a delegate." : " Vekâleten karar vereceksiniz.") : "";
        var link = hasLink
            ? (en ? " You can approve or reject with the button below (single-use link, valid for 72 hours) or in HR360."
                  : " Aşağıdaki düğmeyle (tek kullanımlık, 72 saat geçerli) ya da HR360'ta onaylayabilir veya reddedebilirsiniz.")
            : "";
        return en
            ? ("A request is awaiting your approval",
               $"Hello {approverFirst}, a {type} request from {who} is awaiting your approval.{why}" + (sla is null ? "" : $" Decision due: {Dt(sla.Value, lang)}.") + link)
            : ("Onayınızı bekleyen bir talep var",
               $"Merhaba {approverFirst}, {who} tarafından açılan bir {type} talebi onayınızı bekliyor.{why}" + (sla is null ? "" : $" Son karar tarihi: {Dt(sla.Value, lang)}.") + link);
    }

    public static string TypeLabel(string? type, bool en) => en
        ? type switch { "LeaveRequest" => "leave", "ExpenseClaim" => "expense", "PositionChange" => "position change", "AssetRequest" => "asset",
            "Overtime" => "overtime", "DocumentRequest" => "document", _ => "approval" }
        : type switch { "LeaveRequest" => "izin", "ExpenseClaim" => "masraf", "PositionChange" => "pozisyon değişikliği", "AssetRequest" => "zimmet",
            "Overtime" => "fazla mesai", "DocumentRequest" => "belge", _ => "onay" };

    public static (string Subject, string Body) Decided(string lang, bool approved, string subject, string? comment) => lang == "en"
        ? ($"Your request was {(approved ? "approved" : "rejected")}",
           $"Your request \"{subject}\" was {(approved ? "approved" : "rejected")}." + (string.IsNullOrWhiteSpace(comment) ? "" : $" Reason: {comment}"))
        : ($"Talebiniz {(approved ? "onaylandı" : "reddedildi")}",
           $"\"{subject}\" talebiniz {(approved ? "onaylandı" : "reddedildi")}." + (string.IsNullOrWhiteSpace(comment) ? "" : $" Gerekçe: {comment}"));
}
