using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure.Ai;

namespace GovernanceService.Infrastructure;

/* ======================================================================
 * KVKK temeli:
 *   - Kişisel veri işleme envanteri (VERBİS'e hazırlık; m.16 ve envanter rehberi)
 *   - Yurt dışına aktarım yapan hizmetler ve hukuki dayanak kilidi (m.9)
 *   - Otomatik analiz türleri (m.11/1-g itiraz hakkı)
 * ==================================================================== */

public sealed record ProcessingActivity(
    string Id, string Module, string Activity, string[] Subjects, string[] DataCategories, string Purpose,
    string LegalBasis, bool Special, string Retention, string? RetentionCategory, string[] Recipients,
    string[] TransferProviders, string Measures);

public sealed record TransferProvider(string Key, string Name, string Country, string DataSent, string UsedBy);

public static class PrivacyCatalog
{
    public static readonly TransferProvider[] Providers =
    {
        new("slack", "Slack (Salesforce)", "ABD", "Ad, e-posta, onay talebi özeti, komut yanıtları", "Sohbet botu"),
        new("microsoft", "Microsoft (Teams, Outlook takvimi, Teams toplantısı)", "AB / ABD", "Ad, e-posta, onay kartları, takvim olayları, toplantı katılımcıları", "Sohbet botu, takvim, toplantı"),
        new("google", "Google (Takvim, Meet)", "ABD", "E-posta, takvim olayları (meşgul saatler, onaylı izinler), toplantı katılımcıları", "Takvim, toplantı"),
        new("zoom", "Zoom", "ABD", "Toplantı başlığı, saat, katılımcı e-postaları", "Toplantı"),
        new("anthropic", "Anthropic (yapay zekâ)", "ABD", "Gönderilen metin; kişi adları takma adla değiştirilir", "Yapay zekâ araçları"),
        new("openai", "OpenAI uyumlu yapay zekâ sağlayıcısı", "ABD (sağlayıcıya göre)", "Gönderilen metin; kişi adları takma adla değiştirilir", "Yapay zekâ araçları"),
    };

    public static readonly Dictionary<string, string> Mechanisms = new()
    {
        ["StandardContract"] = "Standart sözleşme (imzadan sonra 5 iş günü içinde Kurul'a bildirilir)",
        ["Adequacy"] = "Yeterlilik kararı",
        ["BindingCorporateRules"] = "Bağlayıcı şirket kuralları (Kurul onaylı)",
        ["Undertaking"] = "Yazılı taahhütname (Kurul izinli)",
    };

    /// <summary>Kişinin itiraz edebileceği, yalnızca otomatik sistemlerle yapılan analizler.</summary>
    public static readonly Dictionary<string, string> Analyses = new()
    {
        ["AttritionRisk"] = "İşten ayrılma riski tahmini (makine öğrenmesi)",
        ["PerformanceScore"] = "Otomatik performans puanı",
        ["AiSummary"] = "Yapay zekâ ile üretilen performans özeti",
    };

    public static readonly ProcessingActivity[] Activities =
    {
        new("employee-record", "Çalışan kaydı", "Özlük dosyası ve çalışan kaydı", new[] { "Çalışanlar" },
            new[] { "Kimlik (ad, soyad)", "İletişim (e-posta, telefon)", "Özlük (işe giriş, pozisyon, departman, yönetici)" },
            "İş sözleşmesinin kurulması ve ifası, özlük dosyasının tutulması",
            "m.5/2-c sözleşmenin ifası; m.5/2-ç hukuki yükümlülük (4857 sayılı İş Kanunu m.75)", false,
            "İş ilişkisi sona erdikten sonra saklama politikasındaki süre", "TerminatedEmployees",
            new[] { "SGK ve yetkili kamu kurumları (talep halinde)" }, Array.Empty<string>(),
            "Rol bazlı erişim, denetim kaydı"),
        new("profile", "Profil", "Self-servis profil: TCKN, IBAN, adres, acil durum kişisi", new[] { "Çalışanlar", "Çalışanların yakınları (acil durum kişisi)" },
            new[] { "Kimlik (TCKN, doğum tarihi)", "Finans (IBAN)", "İletişim (adres, acil durum kişisi)", "Mesleki (beceriler)" },
            "Ücret ödemesi, yasal bildirimler, acil durumda yakına ulaşma",
            "m.5/2-c sözleşmenin ifası; m.5/2-ç hukuki yükümlülük; acil durum kişisi için m.5/2-f meşru menfaat", false,
            "İş ilişkisi sona erdikten sonra saklama politikasındaki süre (sonra anonimleştirilir)", "TerminatedEmployees",
            new[] { "Bankalar (ücret ödemesi)", "SGK" }, Array.Empty<string>(),
            "TCKN ve IBAN veritabanında şifreli, ekranda maskeli; açılması gerekçe ister ve kaydedilir"),
        new("leave", "İzin", "İzin talepleri ve bakiyeleri", new[] { "Çalışanlar" },
            new[] { "İzin kayıtları (tür, tarih, gün)", "Hastalık izni tarihleri (tanı tutulmaz)" },
            "Yıllık ücretli izin ve diğer izinlerin yönetimi",
            "m.5/2-ç hukuki yükümlülük (İş Kanunu m.53-60); hastalık izni için m.6/3 (istihdam ve iş sağlığı yükümlülükleri)", true,
            "İş ilişkisi süresince ve sonrasında yasal süre", null,
            new[] { "SGK (rapor ve eksik gün bildirimleri)" }, Array.Empty<string>(),
            "Hastalık izninde tanı bilgisi tutulmaz; erişim İK ve yöneticiyle sınırlı"),
        new("time", "Puantaj ve vardiya", "Çalışma saatleri, vardiya ve fazla mesai", new[] { "Çalışanlar" },
            new[] { "Çalışma süreleri, vardiya, fazla mesai" },
            "Çalışma süresinin ve fazla mesainin yasal sınırlar içinde yönetimi",
            "m.5/2-ç hukuki yükümlülük (İş Kanunu m.41, m.63)", false,
            "Yasal saklama süresi", null, new[] { "SGK" }, Array.Empty<string>(),
            "Biyometrik veri (parmak izi, yüz) kullanılmaz; konum sürekli izlenmez"),
        new("compensation", "Ücret", "Ücret kayıtları ve ücret bantları", new[] { "Çalışanlar" },
            new[] { "Finans (ücret, yan haklar)" },
            "Ücretin hesaplanması ve ödenmesi, yasal bildirimler",
            "m.5/2-c sözleşmenin ifası; m.5/2-ç hukuki yükümlülük (VUK, 5510 sayılı Kanun)", false,
            "Yasal saklama süresi (vergi ve SGK mevzuatı)", null,
            new[] { "SGK", "Gelir İdaresi Başkanlığı", "Bankalar" }, Array.Empty<string>(),
            "Yalnızca İK; her görüntüleme kaydedilir"),
        new("expense", "Masraf", "Masraf talepleri ve fişler", new[] { "Çalışanlar" },
            new[] { "Finans (tutar, fiş)" }, "Masrafların geri ödenmesi ve muhasebeleştirilmesi",
            "m.5/2-c sözleşmenin ifası; m.5/2-ç hukuki yükümlülük (VUK)", false,
            "Yasal saklama süresi (VUK)", null, new[] { "Muhasebe" }, Array.Empty<string>(), "Rol bazlı erişim"),
        new("performance", "Performans", "Hedefler, değerlendirmeler ve geri bildirim", new[] { "Çalışanlar" },
            new[] { "Performans değerlendirmeleri, hedefler, geri bildirim" },
            "Performans yönetimi ve gelişim planlaması", "m.5/2-f meşru menfaat", false,
            "İş ilişkisi süresince ve sonrasında saklama politikasındaki süre", "TerminatedEmployees",
            Array.Empty<string>(), Array.Empty<string>(), "Sonuçlar çalışana açık; otomatik puana itiraz edilebilir"),
        new("learning", "Eğitim", "Eğitim kayıtları ve sertifikalar", new[] { "Çalışanlar" },
            new[] { "Eğitim ve sertifika kayıtları" }, "Mesleki gelişim, zorunlu İSG eğitimlerinin takibi",
            "m.5/2-c sözleşmenin ifası; m.5/2-ç hukuki yükümlülük (6331 sayılı İSG Kanunu)", false,
            "İş ilişkisi süresince ve sonrasında yasal süre", null, Array.Empty<string>(), Array.Empty<string>(), "Rol bazlı erişim"),
        new("recruitment", "İşe alım", "Aday başvuruları, CV, mülakat notları", new[] { "Çalışan adayları" },
            new[] { "Kimlik", "İletişim", "Mesleki deneyim (CV)", "Mülakat değerlendirmeleri" },
            "İşe alım sürecinin yürütülmesi",
            "m.5/2-c sözleşmenin kurulması; aday havuzunda tutma için açık rıza", false,
            "Olumsuz sonuçlanan başvurularda saklama politikasındaki süre", "RejectedCandidates",
            Array.Empty<string>(), Array.Empty<string>(), "Süre dolunca otomatik anonimleştirme ya da silme"),
        new("onboarding", "İşe başlama ve zimmet", "Onboarding görevleri ve zimmetli varlıklar", new[] { "Çalışanlar" },
            new[] { "Görev kayıtları", "Zimmet kayıtları" }, "İşe başlama sürecinin ve şirket varlıklarının yönetimi",
            "m.5/2-c sözleşmenin ifası", false, "İş ilişkisi süresince", null, Array.Empty<string>(), Array.Empty<string>(), "Rol bazlı erişim"),
        new("notification", "Bildirim", "E-posta ve uygulama içi bildirimler", new[] { "Çalışanlar" },
            new[] { "İletişim (e-posta)", "Bildirim içeriği" }, "İş süreçleriyle ilgili bilgilendirme",
            "m.5/2-c sözleşmenin ifası", false, "Saklama politikasındaki süre", "Notifications",
            new[] { "E-posta sağlayıcısı (SMTP)" }, Array.Empty<string>(),
            "SMTP sağlayıcısı yurt dışındaysa (ör. Gmail, Microsoft 365) yurt dışı aktarım dayanağı gerekir"),
        new("audit", "Denetim kaydı", "Kim, ne zaman, hangi işlemi yaptı", new[] { "Kullanıcılar" },
            new[] { "İşlem güvenliği (kullanıcı kimliği, IP adresi, işlem)" },
            "Veri güvenliğinin sağlanması ve hesap verebilirlik",
            "m.5/2-ç hukuki yükümlülük (m.12 veri güvenliği); m.5/2-f meşru menfaat", false,
            "Saklama politikasındaki süre", "AuditLog", Array.Empty<string>(), Array.Empty<string>(),
            "Hassas alan değerleri kaydedilmez, yalnızca değiştiği bilgisi tutulur"),
        new("engagement", "Etkileşim", "Takdir, anket, mentorluk, 1:1, ofis rezervasyonu", new[] { "Çalışanlar" },
            new[] { "Takdir mesajları", "Anket yanıtları (anonim)", "1:1 notları", "Masa rezervasyonu" },
            "Çalışan bağlılığı ve iç iletişim", "m.5/2-f meşru menfaat", false,
            "İş ilişkisi süresince", null, Array.Empty<string>(), Array.Empty<string>(),
            "Anket yanıtları kimlikle eşleştirilmez; küçük gruplar raporlanmaz"),
        new("calendar", "Takvim ve toplantı", "Takvim bağlantısı, toplantı oluşturma, uygun saat önerisi", new[] { "Çalışanlar", "Adaylar (mülakat)" },
            new[] { "Takvim olayları (meşgul saatler)", "Toplantı katılımcıları (e-posta)" },
            "Toplantıların planlanması ve onaylı izinlerin takvime yazılması",
            "m.5/2-f meşru menfaat; bağlantıyı çalışan kendisi kurar", false,
            "Bağlantı kaldırılınca", null, Array.Empty<string>(), new[] { "google", "microsoft", "zoom" },
            "OAuth jetonları şifreli; yalnızca bağlantıyı kuran kişinin takvimi okunur"),
        new("chat", "Sohbet botu", "Slack ve Microsoft Teams üzerinden onay ve sorgular", new[] { "Çalışanlar" },
            new[] { "Ad, e-posta", "Onay talebi özeti", "İzin bakiyesi (yalnızca kişiye özel)" },
            "Onay süreçlerinin hızlandırılması", "m.5/2-f meşru menfaat", false,
            "Saklama politikasındaki süre", "ChatMessages", Array.Empty<string>(), new[] { "slack", "microsoft" },
            "Hassas veri bota yazılmaz; yanıtlar yalnızca soran kişiye görünür"),
        new("ai", "Yapay zekâ araçları", "İlan taslağı, özet, İK asistanı", new[] { "Çalışanlar", "Adaylar" },
            new[] { "Gönderilen metin", "Kişi adları (takma adla)" },
            "Metin üretimi ve özetleme", "m.5/2-f meşru menfaat; kişisel veri gönderimi için ayrıca kiracı izni", false,
            "Kullanım kayıtları saklama politikasındaki süre", "AiUsage", Array.Empty<string>(), new[] { "anthropic", "openai" },
            "Yerel model (Ollama) önerilir; yurt dışı sağlayıcı dayanak kaydı olmadan çalışmaz"),
        new("automated-analysis", "Otomatik analiz", "İşten ayrılma riski tahmini", new[] { "Çalışanlar" },
            new[] { "Kıdem ve iş verilerinden türetilen özellikler", "Risk skoru" },
            "İK'nın elde tutma çalışmalarına destek", "m.5/2-f meşru menfaat", false,
            "Skor saklanmaz; istek anında hesaplanır", null, Array.Empty<string>(), Array.Empty<string>(),
            "Skor tek başına karar için kullanılamaz; çalışan itiraz edebilir (m.11/1-g), itirazda skor üretilmez"),
        new("privacy", "KVKK kayıtları", "Aydınlatma, açık rıza, ilgili kişi başvuruları, imha tutanakları", new[] { "Çalışanlar", "Kullanıcılar" },
            new[] { "Rıza ve başvuru kayıtları", "IP adresi" }, "KVKK yükümlülüklerinin yerine getirilmesi ve ispatı",
            "m.5/2-ç hukuki yükümlülük", false, "İmha tutanakları en az 3 yıl", null,
            new[] { "Kişisel Verileri Koruma Kurulu (talep halinde)" }, Array.Empty<string>(), "Yalnızca İK"),
        new("identity", "Kimlik doğrulama", "Giriş, oturum ve iki adımlı doğrulama", new[] { "Kullanıcılar" },
            new[] { "Kullanıcı adı, parola özeti, oturum kayıtları" }, "Sisteme güvenli erişim",
            "m.5/2-c sözleşmenin ifası; m.5/2-f meşru menfaat", false, "Hesap kapatılınca", null,
            Array.Empty<string>(), Array.Empty<string>(), "Parola düz metin tutulmaz; isteğe bağlı TOTP ve SSO"),
    };

    /// <summary>İmzadan sonraki n'inci iş gününü verir (hafta sonu hariç).</summary>
    public static DateOnly AddBusinessDays(DateOnly start, int days)
    {
        var d = start;
        while (days > 0)
        {
            d = d.AddDays(1);
            if (d.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) days--;
        }
        return d;
    }
}

/// <summary>Yurt dışı aktarım kilidi: hukuki dayanak kaydı olmayan hizmete veri gönderilmez.</summary>
public static class TransferGuard
{
    public static string ProviderName(string key) =>
        PrivacyCatalog.Providers.FirstOrDefault(p => p.Key == key)?.Name ?? key;

    public static string Message(string provider) =>
        $"KVKK m.9: {ProviderName(provider)} kişisel veriyi yurt dışına aktarır. Önce KVKK › Yurt dışı aktarım ekranında hukuki dayanağı (ör. standart sözleşme) kaydedin.";

    /// <summary>Kiracının hukuki dayanak kaydı olan hizmetleri (arka plan işlerinde de çalışır: kiracı açıkça verilir).</summary>
    public static async Task<HashSet<string>> AllowedAsync(GovernanceDbContext db, string tenant, CancellationToken ct) =>
        (await db.TransferAgreements.IgnoreQueryFilters().AsNoTracking().Where(a => a.TenantSlug == tenant).Select(a => a.Provider).ToListAsync(ct))
        .ToHashSet();

    /// <summary>Kayıt varsa null, yoksa kullanıcıya gösterilecek hata.</summary>
    public static async Task<string?> MissingAsync(GovernanceDbContext db, string tenant, string provider, CancellationToken ct) =>
        (await AllowedAsync(db, tenant, ct)).Contains(provider) ? null : Message(provider);

    /// <summary>Sohbet platformu / takvim sağlayıcısı adından aktarım anahtarı.</summary>
    public static string KeyOf(string platformOrProvider) => platformOrProvider.ToLowerInvariant() switch
    {
        "slack" => "slack",
        "teams" or "microsoft" => "microsoft",
        "google" => "google",
        "zoom" => "zoom",
        var x => x,
    };

    /// <summary>Hizmet şu an kullanımda mı (açık entegrasyon / yapay zekâ sağlayıcısı).</summary>
    public static async Task<Dictionary<string, bool>> InUseAsync(GovernanceDbContext db, LlmClient llm, CancellationToken ct)
    {
        var apps = await db.ChatApps.AsNoTracking().Where(a => a.IsEnabled).Select(a => a.Platform).ToListAsync(ct);
        var providers = await db.ProviderConfigs.AsNoTracking().Where(c => c.IsEnabled).Select(c => c.Provider).ToListAsync(ct);
        var ai = await db.AiSettings.AsNoTracking().AnyAsync(s => s.Enabled, ct);
        var llmKey = LlmProviderKey(llm);
        return PrivacyCatalog.Providers.ToDictionary(p => p.Key, p => p.Key switch
        {
            "slack" => apps.Contains("Slack"),
            "microsoft" => apps.Contains("Teams") || providers.Contains("Microsoft"),
            "google" => providers.Contains("Google"),
            "zoom" => providers.Contains("Zoom"),
            _ => ai && llmKey == p.Key,
        });
    }

    /// <summary>Yapay zekâ sağlayıcısının aktarım anahtarı; yerel modelde null.</summary>
    public static string? LlmProviderKey(LlmClient llm) =>
        !llm.Configured || llm.IsLocal ? null : llm.Provider is "anthropic" or "openai" ? llm.Provider : null;

    public static string Status(Models.TransferAgreement? a, DateOnly today)
    {
        if (a is null) return "Missing";
        if (a.Mechanism != "StandardContract" || a.NotifiedAt is not null) return "Ok";
        return today > PrivacyCatalog.AddBusinessDays(a.SignedAt, 5) ? "NotifyOverdue" : "NotifyPending";
    }
}
