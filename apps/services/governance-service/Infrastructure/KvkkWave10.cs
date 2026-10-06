using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Npgsql;

namespace GovernanceService.Infrastructure;

/* ======================================================================
 * Dalga 10 — KVKK:
 *   53) VERBİS envanteri (bakımı yapılan, kiracıya özel kayıt; dışa aktarım)
 *   54) İlgili kişi başvurusu: 20./27. gün hatırlatması, süre aşımı uyarısı,
 *       erişim başvurusunda otomatik veri paketi (ZIP)
 *   55) Metin yeni sürümünde yeniden onay kampanyası
 * ==================================================================== */

/// <summary>Bir çalışanın tüm modüllerdeki kişisel verisi (KVKK m.11 dökümü). Dışa aktarım ucu ve veri paketi ortak kullanır.</summary>
public static class PersonalDataExport
{
    public static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Bölüm adı → tablo, koşul, sıralama. Tüm tablolar kiracı + çalışan kimliğiyle süzülür.</summary>
    public static readonly (string Section, string Table, string Where, string? Order)[] Sections =
    {
        ("calisan", "employee_employees", "\"Id\" = $2", null),
        ("gorevlendirmeler", "employee_assignments", "\"EmployeeId\" = $2", "\"EffectiveFrom\""),
        ("profil", "engagement_profiles", "\"EmployeeId\" = $2", null),
        ("izinTalepleri", "leave_requests", "\"EmployeeId\" = $2", "\"StartDate\""),
        ("izinBakiyeleri", "leave_balances", "\"EmployeeId\" = $2", "\"Year\""),
        ("puantaj", "timeshift_time_entries", "\"EmployeeId\" = $2", "\"Date\""),
        ("masraflar", "expense_claims", "\"EmployeeId\" = $2", "\"CreatedAt\""),
        ("performansHedefleri", "performance_goals", "\"EmployeeId\" = $2", null),
        ("performansDegerlendirmeleri", "performance_reviews", "\"EmployeeId\" = $2", null),
        ("egitimKayitlari", "learning_enrollments", "\"EmployeeId\" = $2", null),
        ("sertifikalar", "learning_certifications", "\"EmployeeId\" = $2", null),
        ("onboarding", "onboarding_plans", "\"EmployeeId\" = $2", null),
        ("zimmetler", "onboarding_asset_assignments", "\"EmployeeId\" = $2", null),
        ("aldigiTakdirler", "engagement_kudos", "\"ToEmployeeId\" = $2", null),
        ("bildirimler", "notification_messages", "\"RecipientEmployeeId\" = $2", "\"CreatedAt\" DESC"),
    };

    /// <summary>Dökümde açılmaz: kimlik doğrulama/şifreleme ayrıntıları (kişisel veri değil, güvenlik verisi).</summary>
    private static readonly HashSet<string> Hidden = new(StringComparer.Ordinal) { "TenantSlug", "SelfServiceTokenHash", "PinHash", "CardHash" };

    public static async Task<List<Dictionary<string, object?>>> RowsAsync(Sql sql, string tenant, Guid employeeId, string table, string where, string? orderBy, CancellationToken ct)
    {
        var q = $"SELECT * FROM {table} WHERE \"TenantSlug\" = $1 AND {where}{(orderBy is null ? "" : " ORDER BY " + orderBy)} LIMIT 5000";
        try
        {
            return await sql.QueryAsync(q, r =>
            {
                var d = new Dictionary<string, object?>();
                for (var i = 0; i < r.FieldCount; i++)
                {
                    var name = r.GetName(i);
                    if (Hidden.Contains(name)) continue;
                    d[name] = r.IsDBNull(i) ? null : r.GetValue(i) switch { DateOnly x => x.ToString("yyyy-MM-dd"), var v => v };
                }
                return d;
            }, ct, tenant, employeeId);
        }
        catch (PostgresException e) when (e.SqlState is "42P01" or "42703")
        {
            return new();
        }
    }

    /// <summary>engagement-service'in şifrelediği TCKN/IBAN'ı döküm için açar.</summary>
    public static Dictionary<string, object?> OpenPii(Dictionary<string, object?> row)
    {
        foreach (var k in new[] { "Iban", "NationalId" })
            if (row.TryGetValue(k, out var v) && v is string sv && Security.KeyRing.IsSealed(sv))
                row[k] = SecretBox.Unprotect(sv);
        return row;
    }

    public static async Task<Dictionary<string, object?>> BuildAsync(Sql sql, string tenant, Person person, bool includeCompensation, CancellationToken ct)
    {
        var bundle = new Dictionary<string, object?>
        {
            ["hazirlanma"] = DateTime.UtcNow,
            ["aciklama"] = "KVKK m.11 kapsamında, HR360'ta sizinle ilişkili tutulan kişisel verilerin dökümüdür.",
        };
        foreach (var (section, table, where, order) in Sections)
        {
            var rows = await RowsAsync(sql, tenant, person.Id, table, where, order, ct);
            bundle[section] = section == "profil" ? rows.Select(OpenPii).ToList() : rows;
        }
        if (includeCompensation)
            bundle["ucretGecmisi"] = await RowsAsync(sql, tenant, person.Id, "compensation_records", "\"EmployeeId\" = $2", "\"EffectiveFrom\"", ct);
        if (person.UserId is not null)
            bundle["onaylar"] = await sql.QueryAsync("""
                SELECT "ConsentType","Version","Granted","RecordedAt" FROM governance_consents
                WHERE "TenantSlug" = $1 AND "UserId" = $2 ORDER BY "RecordedAt"
                """, r => new { consentType = r.GetString(0), version = r.GetString(1), granted = r.GetBoolean(2), recordedAt = r.GetFieldValue<DateTime>(3) },
                ct, tenant, person.UserId);
        return bundle;
    }

    /// <summary>Kişinin hassas verisine erişim kayıtları (açma, dışa aktarma, otomatik analiz) — şeffaflık için pakete eklenir.</summary>
    public static Task<List<object>> AccessLogAsync(Sql sql, string tenant, Guid employeeId, CancellationToken ct) =>
        sql.QueryAsync<object>("""
            SELECT "OccurredAt","Service","EntityType","Action","UserName" FROM audit_log
            WHERE "TenantSlug" = $1 AND "EntityId" = $2
              AND "Action" IN ('Revealed','SensitiveViewed','Exported','AutomatedAnalysis','PlatformAccess')
              AND "OccurredAt" >= now() - interval '2 years'
            ORDER BY "OccurredAt" DESC LIMIT 2000
            """, r => new { at = r.GetFieldValue<DateTime>(0), service = r.GetString(1), entity = r.GetString(2), action = r.GetString(3), by = r.Str(4) ?? "—" },
            ct, tenant, employeeId.ToString());
}

/* ------------------------------------------------------------------ 54) başvuru süre takibi */

public static class DataRequestReminders
{
    public const int LegalDays = 30;

    /// <summary>
    /// Açık başvurunun bu turda gönderilecek uyarısı: "overdue" (süre geçti), "d27", "d20" ya da null.
    /// Her uyarı bir kez gönderilir; daha ileri bir aşamaya geçilmişse geridekiler atlanır.
    /// </summary>
    public static string? Due(DateTime createdAt, DateTime dueAt, DateTime now, bool sent20, bool sent27, bool sentOverdue)
    {
        if (now > dueAt) return sentOverdue ? null : "overdue";
        var days = (now - createdAt).TotalDays;
        if (days >= 27) return sent27 ? null : "d27";
        if (days >= 20) return sent20 ? null : "d20";
        return null;
    }

    /// <summary>Başvurunun kaçıncı gününde olduğu (1–30; süre geçince 30'dan büyük).</summary>
    public static int DayOf(DateTime createdAt, DateTime now) => Math.Max(1, (int)Math.Floor((now - createdAt).TotalDays) + 1);

    private static readonly Dictionary<string, string> KindTr = new()
    {
        ["Access"] = "bilgi/erişim", ["Rectification"] = "düzeltme", ["Erasure"] = "silme", ["Objection"] = "itiraz",
    };

    public static async Task<int> RunAsync(Sql sql, CancellationToken ct)
    {
        List<(Guid Id, string Tenant, string Kind, DateTime Created, DateTime Due, bool S20, bool S27, bool SO)> open;
        try
        {
            open = await sql.QueryAsync("""
                SELECT "Id","TenantSlug","Kind","CreatedAt","DueAt","Reminder20At" IS NOT NULL,"Reminder27At" IS NOT NULL,"OverdueAlertAt" IS NOT NULL
                FROM governance_data_requests WHERE "Status" IN ('Received','InProgress')
                """, r => (r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTime>(3), r.GetFieldValue<DateTime>(4),
                    r.GetBoolean(5), r.GetBoolean(6), r.GetBoolean(7)), ct);
        }
        catch (PostgresException e) when (e.SqlState == "42703") { return 0; } // göç uygulanmadı
        var sent = 0;
        var now = DateTime.UtcNow;
        foreach (var r in open)
        {
            var stage = Due(r.Created, r.Due, now, r.S20, r.S27, r.SO);
            if (stage is null) continue;
            var column = stage switch { "overdue" => "OverdueAlertAt", "d27" => "Reminder27At", _ => "Reminder20At" };
            // Önce işaretlenir (çift gönderimi önler); alıcı yoksa da işaret kalır, uyum ekranı süreyi gösterir.
            var claimed = await sql.ExecuteAsync($"UPDATE governance_data_requests SET \"{column}\" = now() WHERE \"Id\" = $1 AND \"{column}\" IS NULL", ct, r.Id);
            if (claimed == 0) continue;
            var due = TrTime.ToTr(r.Due).ToString("dd.MM.yyyy");
            var kind = KindTr.GetValueOrDefault(r.Kind, r.Kind);
            var (subTr, subEn, bodyTr, bodyEn) = stage switch
            {
                "overdue" => ("KVKK başvurusunun yasal süresi geçti", "A data subject request is overdue",
                    $"Bir {kind} başvurusu 30 günlük yasal süreyi (KVKK m.13) aştı; son gün {due} idi. Gecikmeden yanıtlayın: KVKK › Başvurular.",
                    $"A {r.Kind} request exceeded the 30-day legal deadline (KVKK art. 13); the last day was {due}. Respond without delay: KVKK › Requests."),
                "d27" => ("KVKK başvurusu: son 3 gün", "Data subject request: 3 days left",
                    $"Bir {kind} başvurusu 27. gününde; en geç {due} tarihinde yanıtlanmalı (KVKK m.13). KVKK › Başvurular.",
                    $"A {r.Kind} request is on day 27; it must be answered by {due} (KVKK art. 13). KVKK › Requests."),
                _ => ("KVKK başvurusu: 10 gün kaldı", "Data subject request: 10 days left",
                    $"Bir {kind} başvurusu 20. gününde; en geç {due} tarihinde yanıtlanmalı (KVKK m.13). KVKK › Başvurular.",
                    $"A {r.Kind} request is on day 20; it must be answered by {due} (KVKK art. 13). KVKK › Requests."),
            };
            var settings = await SecuritySettingsStore.LoadAsync(sql, r.Tenant, ct);
            var to = await SecuritySettingsStore.RecipientsAsync(sql, r.Tenant, settings, ct);
            await BulkNotifyLocalized.InAppAsync(sql, r.Tenant, to, subTr, subEn, bodyTr, bodyEn, "privacy.request." + stage, ct);
            await ComplianceAudit.WriteAsync(sql, r.Tenant, "DataRequest", r.Id.ToString(), stage == "overdue" ? "OverdueAlert" : "DeadlineReminder",
                new { stage, recipients = to.Count, dueAt = r.Due }, "system", "Sistem (KVKK süre takibi)", ct);
            sent++;
        }
        return sent;
    }
}

/* ------------------------------------------------------------------ 54) erişim başvurusu veri paketi */

public static class DataRequestPackages
{
    public const int MaxBytes = 15 * 1024 * 1024;
    public const int KeepDays = 60;

    public sealed record Package(Guid Id, string FileName, string Sha256, int SizeBytes, Dictionary<string, int> Sections);

    /// <summary>ZIP içeriği: kisisel-veri.json, erisim-kayitlari.json, basvuru.txt, BENIOKU.txt, manifest.json (SHA-256).</summary>
    public static byte[] BuildZip(Dictionary<string, object?> bundle, List<object> accessLog, string requestSummary, DateTime now)
    {
        var files = new List<(string Name, byte[] Data)>
        {
            ("kisisel-veri.json", JsonSerializer.SerializeToUtf8Bytes(bundle, PersonalDataExport.Json)),
            ("erisim-kayitlari.json", JsonSerializer.SerializeToUtf8Bytes(accessLog, PersonalDataExport.Json)),
            ("basvuru.txt", Encoding.UTF8.GetBytes(requestSummary)),
            ("BENIOKU.txt", Encoding.UTF8.GetBytes(Readme)),
        };
        var manifest = files.Select(f => new { file = f.Name, bytes = f.Data.Length, sha256 = Convert.ToHexString(SHA256.HashData(f.Data)).ToLowerInvariant() }).ToList();
        files.Add(("manifest.json", JsonSerializer.SerializeToUtf8Bytes(new { createdAt = now, files = manifest }, PersonalDataExport.Json)));
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (name, data) in files)
            {
                var e = zip.CreateEntry(name, CompressionLevel.Optimal);
                e.LastWriteTime = new DateTimeOffset(now, TimeSpan.Zero);
                using var s = e.Open();
                s.Write(data);
            }
        }
        return ms.ToArray();
    }

    public const string Readme = """
        HR360 — KİŞİSEL VERİ PAKETİ (KVKK m.11)

        Bu paket, bilgi/erişim başvurunuz üzerine HR360'ta sizinle ilişkili tutulan kişisel verilerden hazırlanmıştır.

        kisisel-veri.json      Çalışan kaydı, görevlendirmeler, profil, izin, puantaj, masraf, performans, eğitim,
                               işe başlama/zimmet, takdir, bildirim kayıtları ve rıza geçmişiniz (modül başına bölüm).
        erisim-kayitlari.json  Hassas verilerinize son 2 yılda kimin, ne zaman eriştiği (açma, dışa aktarma, otomatik analiz).
        basvuru.txt            Başvurunuzun özeti ve yasal süre.
        manifest.json          Dosyaların SHA-256 özetleri (bütünlük kontrolü).

        Verilerin işlenme amaçları, hukuki sebepleri, aktarıldığı alıcı grupları ve saklama süreleri şirketin aydınlatma
        metninde ve kişisel veri envanterinde yer alır. Düzeltme, silme ya da itiraz için HR360 › Profilim › Gizlilik
        ekranından yeni başvuru yapabilirsiniz. Başvurunuza verilen yanıtı yetersiz bulursanız tebliğden itibaren 30 gün
        içinde Kişisel Verileri Koruma Kurulu'na şikâyette bulunabilirsiniz (KVKK m.14).

        Bu dosyayı güvenli bir yerde saklayın; içinde kimlik ve finans bilgileriniz bulunabilir.
        """;

    public static string Summary(string kind, string person, DateTime createdAt, DateTime dueAt, string channel) => string.Join('\n',
        "İLGİLİ KİŞİ BAŞVURUSU ÖZETİ",
        $"Başvuran: {person}",
        $"Tür: {kind}",
        $"Kanal: {channel}",
        $"Başvuru tarihi: {TrTime.ToTr(createdAt):dd.MM.yyyy HH:mm}",
        $"Yasal yanıt süresi sonu (KVKK m.13, 30 gün): {TrTime.ToTr(dueAt):dd.MM.yyyy}",
        $"Paket hazırlanma: {TrTime.ToTr(DateTime.UtcNow):dd.MM.yyyy HH:mm}");

    public static Dictionary<string, int> SectionCounts(Dictionary<string, object?> bundle) =>
        bundle.Where(kv => kv.Value is System.Collections.ICollection).ToDictionary(kv => kv.Key, kv => ((System.Collections.ICollection)kv.Value!).Count);

    /// <summary>Paketi üretir, şifreli saklar (önceki paket silinir) ve denetim kaydı yazar.</summary>
    public static async Task<Package?> CreateAsync(Sql sql, string tenant, Guid requestId, PeopleDirectory people, string actorId, string actorName, CancellationToken ct)
    {
        var req = (await sql.QueryAsync("""
            SELECT "EmployeeId","Kind","PersonName","CreatedAt","DueAt","Channel","IdentityVerified" FROM governance_data_requests
            WHERE "TenantSlug" = $1 AND "Id" = $2
            """, r => (Emp: r.GuidOrNull(0), Kind: r.GetString(1), Person: r.GetString(2), Created: r.GetFieldValue<DateTime>(3),
                Due: r.GetFieldValue<DateTime>(4), Channel: r.GetString(5), Verified: r.GetBoolean(6)), ct, tenant, requestId)).FirstOrDefault();
        if (req.Emp is not { } empId || !req.Verified) return null;
        var person = await people.FindAsync(tenant, empId, ct);
        if (person is null) return null;
        var bundle = await PersonalDataExport.BuildAsync(sql, tenant, person, includeCompensation: true, ct);
        var access = await PersonalDataExport.AccessLogAsync(sql, tenant, empId, ct);
        var kindTr = req.Kind switch { "Access" => "Bilgi/erişim talebi", "Rectification" => "Düzeltme", "Erasure" => "Silme", "Objection" => "İtiraz", var k => k };
        var zip = BuildZip(bundle, access, Summary(kindTr, person.Name, req.Created, req.Due, req.Channel), DateTime.UtcNow);
        if (zip.Length > MaxBytes) throw new InvalidOperationException("Veri paketi 15 MB sınırını aşıyor.");
        var sha = Convert.ToHexString(SHA256.HashData(zip)).ToLowerInvariant();
        var id = Guid.NewGuid();
        var file = $"kisisel-veri-paketi-{DateTime.UtcNow:yyyyMMdd}.zip";
        var sections = SectionCounts(bundle);
        sections["erisimKayitlari"] = access.Count;
        await sql.ExecuteAsync("DELETE FROM governance_data_request_packages WHERE \"TenantSlug\" = $1 AND \"RequestId\" = $2", ct, tenant, requestId);
        await sql.ExecuteAsync("""
            INSERT INTO governance_data_request_packages ("Id","TenantSlug","RequestId","EmployeeId","FileName","ContentEnc","Sha256","SizeBytes","Sections","CreatedBy","CreatedAt","ExpiresAt")
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,now(),now() + make_interval(days => $11))
            """, ct, id, tenant, requestId, empId, file, SecretBox.Protect(Convert.ToBase64String(zip)), sha, zip.Length,
            JsonSerializer.Serialize(sections), actorName, KeepDays);
        await ComplianceAudit.WriteAsync(sql, tenant, "DataRequest", requestId.ToString(), "PackagePrepared",
            new { packageId = id, sha256 = sha, bytes = zip.Length, sections }, actorId, actorName, ct);
        return new Package(id, file, sha, zip.Length, sections);
    }

    public static Task<int> PurgeExpiredAsync(Sql sql, CancellationToken ct) =>
        sql.ExecuteAsync("DELETE FROM governance_data_request_packages WHERE \"ExpiresAt\" < now()", ct);
}

/* ------------------------------------------------------------------ 55) yeniden onay kampanyası */

public static class ConsentCampaigns
{
    public const int AutoReminderDays = 7;
    public const int MaxAutoReminders = 3;

    public sealed record LatestConsent(string UserId, string Version, bool Granted);

    /// <summary>
    /// Kampanyanın hedefi: aydınlatma (zorunlu bilgilendirme) için hesabı olan TÜM çalışanlar; açık rıza tipleri için
    /// eski sürüme ONAY vermiş olanlar (rızaları eski metne dayandığından yeniden sorulur). Reddetmiş ya da hiç
    /// yanıtlamamış kişi kampanya hedefi değildir (rıza zorlanmaz).
    /// </summary>
    public static bool IsTarget(bool required, LatestConsent? latest, string version) =>
        required || (latest is { Granted: true } && latest.Version != version);

    /// <summary>Kişi yeni sürüme yanıt verdi mi (zorunluda "okudum", rızada onay ya da ret).</summary>
    public static bool IsDone(bool required, LatestConsent? latest, string version) =>
        latest is not null && latest.Version == version && (!required || latest.Granted);

    public static async Task StartAsync(Sql sql, string tenant, string type, string version, string? previousVersion, string startedBy, CancellationToken ct)
    {
        try
        {
            await sql.ExecuteAsync("""
                UPDATE governance_consent_campaigns SET "Status" = 'Closed', "ClosedAt" = now(), "ClosedBy" = 'Sistem (yeni sürüm yayımlandı)'
                WHERE "TenantSlug" = $1 AND "ConsentType" = $2 AND "Status" = 'Open'
                """, ct, tenant, type);
            await sql.ExecuteAsync("""
                INSERT INTO governance_consent_campaigns ("Id","TenantSlug","ConsentType","Version","PreviousVersion","Status","StartedBy","StartedAt")
                VALUES ($1,$2,$3,$4,$5,'Open',$6,now()) ON CONFLICT ("TenantSlug","ConsentType","Version") DO NOTHING
                """, ct, Guid.NewGuid(), tenant, type, version, previousVersion, startedBy);
        }
        catch (PostgresException e) when (e.SqlState == "42P01") { } // göç uygulanmadı: kampanya yok, yayın sürer
    }

    public sealed record Campaign(Guid Id, string Type, string Version, string? PreviousVersion, string Status, string StartedBy, DateTime StartedAt,
        DateTime? ClosedAt, int ReminderCount, DateTime? LastReminderAt);

    public static Task<List<Campaign>> ListAsync(Sql sql, string tenant, CancellationToken ct, bool openOnly = false) =>
        sql.QueryAsync($"""
            SELECT "Id","ConsentType","Version","PreviousVersion","Status","StartedBy","StartedAt","ClosedAt","ReminderCount","LastReminderAt"
            FROM governance_consent_campaigns WHERE "TenantSlug" = $1 {(openOnly ? "AND \"Status\" = 'Open'" : "")} ORDER BY "StartedAt" DESC LIMIT 200
            """, r => new Campaign(r.GetGuid(0), r.GetString(1), r.GetString(2), r.Str(3), r.GetString(4), r.GetString(5), r.GetFieldValue<DateTime>(6),
                r.Ts(7), r.GetInt32(8), r.Ts(9)), ct, tenant);

    public static async Task<Dictionary<(string User, string Type), LatestConsent>> LatestAsync(Sql sql, string tenant, CancellationToken ct) =>
        (await sql.QueryAsync("""
            SELECT DISTINCT ON ("UserId","ConsentType") "UserId","ConsentType","Version","Granted"
            FROM governance_consents WHERE "TenantSlug" = $1 ORDER BY "UserId","ConsentType","RecordedAt" DESC
            """, r => (User: r.GetString(0), Type: r.GetString(1), C: new LatestConsent(r.GetString(0), r.GetString(2), r.GetBoolean(3))), ct, tenant))
        .ToDictionary(x => (x.User, x.Type), x => x.C);

    public sealed record Progress(int Target, int Done, List<Person> Pending);

    public static Progress Compute(bool required, string type, string version, IEnumerable<Person> people, IReadOnlyDictionary<(string, string), LatestConsent> latest)
    {
        var target = 0; var done = 0; var pending = new List<Person>();
        foreach (var p in people.Where(p => p.UserId is not null))
        {
            latest.TryGetValue((p.UserId!, type), out var l);
            if (IsDone(required, l, version)) { target++; done++; continue; }
            if (!IsTarget(required, l, version)) continue;
            target++;
            pending.Add(p);
        }
        return new Progress(target, done, pending);
    }

    /// <summary>Bekleyenlere uygulama içi hatırlatma (yalnızca metin başlığı; kişisel veri yok).</summary>
    public static async Task<int> RemindAsync(Sql sql, string tenant, Campaign c, string title, IEnumerable<Guid> pending, string actorId, string actorName, CancellationToken ct)
    {
        var ids = pending.ToList();
        var sent = await BulkNotifyLocalized.InAppAsync(sql, tenant, ids,
            "Güncellenen metni okuyup yanıtlayın", "Please review the updated notice",
            $"\"{title}\" metni güncellendi (sürüm {c.Version}). Profilim › Gizlilik (KVKK) ekranından okuyup yanıtlayın.",
            $"The notice \"{title}\" was updated (version {c.Version}). Review and respond under My profile › Privacy (KVKK).",
            "privacy.reconsent", ct);
        await sql.ExecuteAsync("""
            UPDATE governance_consent_campaigns SET "ReminderCount" = "ReminderCount" + 1, "LastReminderAt" = now() WHERE "Id" = $1
            """, ct, c.Id);
        await ComplianceAudit.WriteAsync(sql, tenant, "ConsentCampaign", c.Id.ToString(), "ReminderSent",
            new { c.Type, c.Version, recipients = sent }, actorId, actorName, ct);
        return sent;
    }

    /// <summary>Haftalık otomatik hatırlatma (en çok 3 kez); kampanya başladıktan 7 gün sonra başlar.</summary>
    public static async Task<int> AutoRemindAsync(Sql sql, CancellationToken ct)
    {
        List<(string Tenant, Guid Id)> due;
        try
        {
            due = await sql.QueryAsync("""
                SELECT "TenantSlug","Id" FROM governance_consent_campaigns
                WHERE "Status" = 'Open' AND "ReminderCount" < $1 AND "StartedAt" < now() - make_interval(days => $2)
                  AND ("LastReminderAt" IS NULL OR "LastReminderAt" < now() - make_interval(days => $2))
                """, r => (r.GetString(0), r.GetGuid(1)), ct, MaxAutoReminders, AutoReminderDays);
        }
        catch (PostgresException e) when (e.SqlState == "42P01") { return 0; }
        var total = 0;
        var people = new PeopleDirectory(sql);
        foreach (var tenantGroup in due.GroupBy(d => d.Tenant))
        {
            var tenant = tenantGroup.Key;
            var campaigns = await ListAsync(sql, tenant, ct, openOnly: true);
            var types = await EffectiveTypesAsync(sql, tenant, ct);
            var staff = await people.ListAsync(tenant, ct);
            var latest = await LatestAsync(sql, tenant, ct);
            foreach (var c in campaigns.Where(c => tenantGroup.Any(d => d.Id == c.Id)))
            {
                var t = types.FirstOrDefault(x => x.Type == c.Type);
                if (t is null || t.Version != c.Version) continue;
                var prog = Compute(t.Required, c.Type, c.Version, staff, latest);
                if (prog.Pending.Count == 0) continue;
                total += await RemindAsync(sql, tenant, c, t.Title, prog.Pending.Select(p => p.Id), "system", "Sistem (otomatik hatırlatma)", ct);
            }
        }
        return total;
    }

    /// <summary>Kiracının geçerli metinleri (EF olmadan; arka plan işi için). Yerleşik + kiracının yayımladığı son sürüm.</summary>
    public static async Task<List<Controllers.PrivacyController.ConsentType>> EffectiveTypesAsync(Sql sql, string tenant, CancellationToken ct)
    {
        var notices = await sql.QueryAsync("""
            SELECT DISTINCT ON ("Type") "Type","Title","Version","Text" FROM governance_privacy_notices
            WHERE "TenantSlug" = $1 ORDER BY "Type","PublishedAt" DESC
            """, r => (Type: r.GetString(0), Title: r.GetString(1), Version: r.GetString(2), Text: r.GetString(3)), ct, tenant);
        return Controllers.PrivacyController.ConsentTypes.Select(t =>
        {
            var n = notices.FirstOrDefault(x => x.Type == t.Type);
            return n.Type is null ? t : t with { Title = n.Title, Version = n.Version, Text = n.Text };
        }).ToList();
    }
}

/* ------------------------------------------------------------------ 53) VERBİS envanteri */

public static class VerbisInventory
{
    private static readonly System.Text.Encodings.Web.HtmlEncoder HtmlText =
        System.Text.Encodings.Web.HtmlEncoder.Create(System.Text.Unicode.UnicodeRanges.All);

    public sealed record Item(Guid Id, string Key, string Source, string Module, string Activity, string[] Subjects, string[] DataCategories,
        string Purpose, string LegalBasis, bool Special, string Retention, string? RetentionCategory, string[] Recipients,
        string[] TransferProviders, string Measures, bool IsActive, DateTime UpdatedAt, string? UpdatedByName);

    /// <summary>Ürün kataloğundaki (ve özel alanlardan türeyen) faaliyetlerden eksik olanları ekler; düzenlenmiş satırlara dokunmaz.</summary>
    public static async Task<int> SeedAsync(Sql sql, string tenant, IEnumerable<ProcessingActivity> activities, string? userId, string userName, CancellationToken ct)
    {
        var added = 0;
        foreach (var a in activities)
            added += await sql.ExecuteAsync("""
                INSERT INTO governance_privacy_inventory ("Id","TenantSlug","ActivityKey","Source","Module","Activity","Subjects","DataCategories","Purpose",
                    "LegalBasis","Special","Retention","RetentionCategory","Recipients","TransferProviders","Measures","IsActive","CreatedAt","UpdatedAt","UpdatedBy","UpdatedByName")
                VALUES ($1,$2,$3,'Catalog',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,now(),now(),$16,$17)
                ON CONFLICT ("TenantSlug","ActivityKey") DO NOTHING
                """, ct, Guid.NewGuid(), tenant, a.Id, a.Module, a.Activity, a.Subjects, a.DataCategories, a.Purpose, a.LegalBasis, a.Special,
                a.Retention, a.RetentionCategory, a.Recipients, a.TransferProviders, a.Measures, userId, userName);
        return added;
    }

    public static Task<List<Item>> ListAsync(Sql sql, string tenant, CancellationToken ct) =>
        sql.QueryAsync("""
            SELECT "Id","ActivityKey","Source","Module","Activity","Subjects","DataCategories","Purpose","LegalBasis","Special","Retention",
                   "RetentionCategory","Recipients","TransferProviders","Measures","IsActive","UpdatedAt","UpdatedByName"
            FROM governance_privacy_inventory WHERE "TenantSlug" = $1 ORDER BY "Module","Activity"
            """, r => new Item(r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetFieldValue<string[]>(5),
                r.GetFieldValue<string[]>(6), r.GetString(7), r.GetString(8), r.GetBoolean(9), r.GetString(10), r.Str(11),
                r.GetFieldValue<string[]>(12), r.GetFieldValue<string[]>(13), r.GetString(14), r.GetBoolean(15), r.GetFieldValue<DateTime>(16), r.Str(17)),
            ct, tenant);

    /// <summary>"Kimlik (ad, soyad)" → ("Kimlik", "ad, soyad"). Parantez yoksa açıklama boş.</summary>
    public static (string Category, string Detail) SplitCategory(string s)
    {
        s = (s ?? "").Trim();
        var i = s.IndexOf(" (", StringComparison.Ordinal);
        if (i > 0 && s.EndsWith(')')) return (s[..i].Trim(), s[(i + 2)..^1].Trim());
        return (s, "");
    }

    public sealed record TransferInfo(string Key, string Name, string Country, string Mechanism, bool InUse);

    /// <summary>VERBİS sütunları (Veri Sorumluları Sicil Bilgi Sistemi alanlarıyla aynı sırada).</summary>
    public static readonly string[] Columns =
    {
        "Veri kategorisi", "Kişisel veri", "İşleme amacı", "Hukuki sebep", "İlgili kişi grubu", "Alıcı / alıcı grubu",
        "Saklama süresi", "Yurt dışına aktarım", "Özel nitelikli", "İdari ve teknik tedbirler", "İşleme faaliyeti", "Modül",
    };

    /// <summary>Etkin her faaliyet × veri kategorisi bir satır. Yurt dışı aktarım, kayıtlı dayanağıyla birlikte yazılır.</summary>
    public static List<string[]> Rows(IEnumerable<Item> items, IReadOnlyDictionary<string, TransferInfo> transfers)
    {
        var rows = new List<string[]>();
        foreach (var a in items.Where(i => i.IsActive))
        {
            var abroad = a.TransferProviders.Length == 0 ? "Yok"
                : string.Join("; ", a.TransferProviders.Select(k => transfers.TryGetValue(k, out var t)
                    ? $"{t.Name} ({t.Country}) — {t.Mechanism}{(t.InUse ? "" : ", kullanılmıyor")}" : k));
            var categories = a.DataCategories.Length == 0 ? new[] { "" } : a.DataCategories;
            foreach (var c in categories)
            {
                var (cat, detail) = SplitCategory(c);
                rows.Add(new[]
                {
                    cat, detail, a.Purpose, a.LegalBasis, string.Join(", ", a.Subjects), a.Recipients.Length == 0 ? "Yok" : string.Join(", ", a.Recipients),
                    a.Retention, abroad, a.Special ? "Evet" : "Hayır", a.Measures, a.Activity, a.Module,
                });
            }
        }
        return rows;
    }

    /// <summary>CSV (noktalı virgül ayraçlı, UTF-8 BOM — Türkçe Excel doğrudan açar). Formül enjeksiyonuna karşı = + - @ ile başlayan hücre kaçırılır.</summary>
    public static string Csv(IEnumerable<string[]> rows)
    {
        static string Cell(string v)
        {
            v ??= "";
            if (v.Length > 0 && "=+-@\t\r".Contains(v[0])) v = "'" + v;
            return v.IndexOfAny(new[] { ';', '"', '\n', '\r' }) >= 0 ? "\"" + v.Replace("\"", "\"\"") + "\"" : v;
        }
        var sb = new StringBuilder("﻿");
        sb.AppendLine(string.Join(';', Columns.Select(Cell)));
        foreach (var r in rows) sb.AppendLine(string.Join(';', r.Select(Cell)));
        return sb.ToString();
    }

    /// <summary>Yazdırılabilir HTML (tarayıcıdan PDF'e). Tüm değerler HTML kaçışlıdır.</summary>
    public static string Html(string company, IEnumerable<string[]> rows, DateTime generatedAt, DateTime? lastUpdated, string? lastUpdatedBy, int activities)
    {
        // Türkçe harfler sayısal varlığa çevrilmeden (okunur kaynak), < > & " ' kaçışlı.
        static string E(string? s) => HtmlText.Encode(s ?? "");
        var sb = new StringBuilder();
        sb.Append("<!doctype html><html lang=\"tr\"><head><meta charset=\"utf-8\"><title>")
          .Append(E($"Kişisel veri işleme envanteri — {company}"))
          .Append("</title><style>body{font:11px/1.4 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}")
          .Append("p.meta{color:#555;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:4px 6px;vertical-align:top;text-align:left}")
          .Append("th{background:#f1f1f1}tr{page-break-inside:avoid}@page{size:A4 landscape;margin:12mm}@media print{.no-print{display:none}}</style></head><body>")
          .Append("<button class=\"no-print\" onclick=\"window.print()\">Yazdır</button>")
          .Append("<h1>").Append(E($"Kişisel veri işleme envanteri — {company}")).Append("</h1><p class=\"meta\">")
          .Append(E($"KVKK m.16 / VERBİS. Oluşturma: {TrTime.ToTr(generatedAt):dd.MM.yyyy HH:mm}. "))
          .Append(E(lastUpdated is null ? "" : $"Son güncelleme: {TrTime.ToTr(lastUpdated.Value):dd.MM.yyyy HH:mm}{(lastUpdatedBy is null ? "" : " — " + lastUpdatedBy)}. "))
          .Append(E($"{activities} işleme faaliyeti.")).Append("</p><table><thead><tr>");
        foreach (var c in Columns) sb.Append("<th>").Append(E(c)).Append("</th>");
        sb.Append("</tr></thead><tbody>");
        foreach (var r in rows)
        {
            sb.Append("<tr>");
            foreach (var v in r) sb.Append("<td>").Append(E(v)).Append("</td>");
            sb.Append("</tr>");
        }
        sb.Append("</tbody></table></body></html>");
        return sb.ToString();
    }

    /// <summary>Düzenleme girdisinin doğrulaması (null = geçerli). Liste alanları kırpılır, boşlar atılır.</summary>
    public static string? Validate(string? module, string? activity, string? purpose, string? legalBasis, string? retention, IReadOnlyCollection<string>? categories, IReadOnlyCollection<string>? subjects)
    {
        if (string.IsNullOrWhiteSpace(module) || module.Trim().Length > 120) return "Modül gerekli (en fazla 120 karakter).";
        if (string.IsNullOrWhiteSpace(activity) || activity.Trim().Length > 300) return "İşleme faaliyeti gerekli (en fazla 300 karakter).";
        if (string.IsNullOrWhiteSpace(purpose)) return "İşleme amacı gerekli.";
        if (string.IsNullOrWhiteSpace(legalBasis)) return "Hukuki sebep gerekli (KVKK m.5 / m.6).";
        if (string.IsNullOrWhiteSpace(retention)) return "Saklama süresi gerekli.";
        if (categories is null || categories.Count(c => !string.IsNullOrWhiteSpace(c)) == 0) return "En az bir veri kategorisi gerekli.";
        if (subjects is null || subjects.Count(c => !string.IsNullOrWhiteSpace(c)) == 0) return "En az bir ilgili kişi grubu gerekli.";
        foreach (var v in new[] { purpose, legalBasis, retention })
            if (v!.Length > 4000) return "Metin alanları en fazla 4000 karakter.";
        return null;
    }

    public static string[] CleanList(IEnumerable<string>? items, int max = 50) =>
        (items ?? Enumerable.Empty<string>()).Select(s => s?.Trim() ?? "").Where(s => s.Length is > 0 and <= 300)
            .Distinct(StringComparer.OrdinalIgnoreCase).Take(max).ToArray();
}
