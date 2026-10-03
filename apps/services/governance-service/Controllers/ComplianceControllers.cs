using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;
using GovernanceService.Models;

namespace GovernanceService.Controllers;

/* ======================================================================
 * KVKK araçları: açık rıza/aydınlatma kayıtları, ilgili kişi başvuruları
 * (KVKK m.11 — 30 gün içinde yanıt), kişisel veri dışa aktarımı,
 * ayrılmış çalışanın anonimleştirilmesi ve saklama süresi politikaları.
 * ==================================================================== */
[Route("api/privacy")]
[Authorize]
[RequiresPlan("Standard")]
public class PrivacyController : AppController
{
    public sealed record ConsentType(string Type, string Title, string Version, bool Required, string Text);

    public static readonly ConsentType[] ConsentTypes =
    {
        new("KVKK_AYDINLATMA", "Aydınlatma metni (KVKK m.10)", "2026.1", true,
            "Kişisel verileriniz; iş sözleşmesinin kurulması ve ifası, yasal yükümlülükler (SGK, vergi, İSG) ve meşru menfaat kapsamında, İK süreçlerinin yürütülmesi amacıyla işlenir. Haklarınız için İK ile iletişime geçebilir veya bu ekrandan başvuru yapabilirsiniz."),
        new("ACIK_RIZA_SAGLIK", "Sağlık verilerinin işlenmesi", "2026.1", false,
            "Rapor, iş kazası ve periyodik muayene kayıtlarınızın İK ve işyeri hekimi tarafından işlenmesine açık rıza veriyorum."),
        new("ACIK_RIZA_YURTDISI", "Yurt dışına veri aktarımı", "2026.1", false,
            "Grup şirketleriyle ortak kullanılan sistemler nedeniyle kişisel verilerimin yurt dışına aktarılmasına açık rıza veriyorum."),
        new("ILETISIM_IZNI", "Etkinlik ve duyuru iletişimi", "2026.1", false,
            "Şirket içi etkinlik, anket ve duyuruların e-posta/SMS ile tarafıma iletilmesini kabul ediyorum."),
        new("GORSEL_KULLANIM", "Fotoğraf ve ad kullanımı", "2026.1", false,
            "Şirket içi iletişimde (intranet, bülten) fotoğrafımın ve adımın kullanılmasına izin veriyorum."),
    };

    private readonly GovernanceDbContext _db;
    public PrivacyController(GovernanceDbContext db) => _db = db;

    [HttpGet("consent-types")]
    public IActionResult Types() => Ok(ConsentTypes);

    [HttpGet("consents/me")]
    public async Task<IActionResult> MyConsents(CancellationToken ct)
    {
        var mine = await _db.Consents.AsNoTracking().Where(c => c.UserId == Me.UserId).OrderByDescending(c => c.RecordedAt).ToListAsync(ct);
        return Ok(ConsentTypes.Select(t =>
        {
            var last = mine.FirstOrDefault(c => c.ConsentType == t.Type);
            return new { t.Type, t.Title, t.Version, t.Required, t.Text, granted = last?.Granted, recordedAt = last?.RecordedAt,
                outdated = last is not null && last.Version != t.Version, history = mine.Where(c => c.ConsentType == t.Type).Take(5).Select(c => new { c.Granted, c.Version, c.RecordedAt }) };
        }));
    }

    public record ConsentInput(string ConsentType, bool Granted);

    [HttpPost("consents/me")]
    public async Task<IActionResult> Record(ConsentInput body, CancellationToken ct)
    {
        var t = ConsentTypes.FirstOrDefault(x => x.Type == body.ConsentType);
        if (t is null) return BadRequest(new { message = "Bilinmeyen onay tipi." });
        if (t.Required && !body.Granted) return BadRequest(new { message = "Aydınlatma metni okundu olarak işaretlenmelidir (bu bir rıza değil, bilgilendirmedir)." });
        var me = await MyPersonAsync(ct);
        _db.Consents.Add(new Consent
        {
            UserId = Me.UserId, EmployeeId = me?.Id, PersonName = me?.Name ?? Me.Name, ConsentType = t.Type, Version = t.Version,
            Granted = body.Granted, IpAddress = Request.Headers["X-Real-IP"].FirstOrDefault() ?? HttpContext.Connection.RemoteIpAddress?.ToString(),
        });
        await _db.SaveChangesAsync(ct);
        return Ok(new { ok = true });
    }

    [HttpGet("consents")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> ConsentSummary(CancellationToken ct)
    {
        var people = await People.ListAsync(Tenant, ct);
        var all = await _db.Consents.AsNoTracking().ToListAsync(ct);
        var latest = all.GroupBy(c => (c.UserId, c.ConsentType)).Select(g => g.OrderByDescending(c => c.RecordedAt).First()).ToList();
        return Ok(new
        {
            population = people.Count,
            types = ConsentTypes.Select(t => new
            {
                t.Type, t.Title, t.Required, t.Version,
                granted = latest.Count(c => c.ConsentType == t.Type && c.Granted),
                denied = latest.Count(c => c.ConsentType == t.Type && !c.Granted),
                pending = Math.Max(0, people.Count - latest.Count(c => c.ConsentType == t.Type)),
            }),
            missingRequired = people.Where(p => p.UserId is not null && !latest.Any(c => c.UserId == p.UserId && c.ConsentType == "KVKK_AYDINLATMA"))
                .Select(p => new { employeeId = p.Id, name = p.Name, department = p.Department }),
        });
    }

    /* ---------------------------------------------------- ilgili kişi başvurusu */

    public record RequestInput(string Kind, string? Details);

    [HttpPost("requests")]
    public async Task<IActionResult> CreateRequest(RequestInput body, CancellationToken ct)
    {
        if (body.Kind is not ("Access" or "Rectification" or "Erasure" or "Objection"))
            return BadRequest(new { message = "Geçersiz başvuru türü." });
        var me = await MyPersonAsync(ct);
        var r = new DataRequest { UserId = Me.UserId, EmployeeId = me?.Id, PersonName = me?.Name ?? Me.Name, Kind = body.Kind, Details = body.Details?.Trim() };
        _db.DataRequests.Add(r);
        await _db.SaveChangesAsync(ct);
        return Ok(r);
    }

    [HttpGet("requests")]
    public async Task<IActionResult> Requests(CancellationToken ct)
    {
        var q = _db.DataRequests.AsNoTracking();
        if (!Me.IsHr) q = q.Where(r => r.UserId == Me.UserId);
        var rows = await q.OrderByDescending(r => r.CreatedAt).ToListAsync(ct);
        return Ok(rows.Select(r => new { r.Id, r.PersonName, r.EmployeeId, r.Kind, r.Details, r.Status, r.Response, r.DueAt, r.CreatedAt, r.CompletedAt,
            overdue = r.Status is "Received" or "InProgress" && r.DueAt < DateTime.UtcNow, daysLeft = (int)Math.Ceiling((r.DueAt - DateTime.UtcNow).TotalDays) }));
    }

    public record RequestUpdate(string Status, string? Response);

    [HttpPatch("requests/{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> UpdateRequest(Guid id, RequestUpdate body, CancellationToken ct)
    {
        var r = await _db.DataRequests.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null) return NotFound();
        if (body.Status is not ("Received" or "InProgress" or "Completed" or "Rejected")) return BadRequest(new { message = "Geçersiz durum." });
        if (body.Status is "Completed" or "Rejected" && string.IsNullOrWhiteSpace(body.Response))
            return BadRequest(new { message = "Sonuçlandırırken başvurucuya yanıt yazılmalı (KVKK m.13)." });
        r.Status = body.Status;
        r.Response = body.Response ?? r.Response;
        r.CompletedAt = body.Status is "Completed" or "Rejected" ? DateTime.UtcNow : null;
        await _db.SaveChangesAsync(ct);
        return Ok(r);
    }

    /* ---------------------------------------------------------- veri dışa aktarımı */

    /// <summary>Bir çalışanın tüm modüllerdeki kişisel verisi (JSON). Sahibi veya İK.</summary>
    [HttpGet("export/{employeeId:guid}")]
    public async Task<IActionResult> Export(Guid employeeId, CancellationToken ct)
    {
        var me = await MyPersonAsync(ct);
        if (me?.Id != employeeId && !Me.IsHr) return Forbid();
        var person = await People.FindAsync(Tenant, employeeId, ct);
        if (person is null) return NotFound();

        async Task<List<Dictionary<string, object?>>> Rows(string table, string where, string? orderBy = null)
        {
            var sql = $"SELECT * FROM {table} WHERE \"TenantSlug\" = $1 AND {where}{(orderBy is null ? "" : " ORDER BY " + orderBy)} LIMIT 5000";
            return await Db.QueryAsync(sql, r =>
            {
                var d = new Dictionary<string, object?>();
                for (var i = 0; i < r.FieldCount; i++)
                {
                    var name = r.GetName(i);
                    if (name == "TenantSlug") continue;
                    d[name] = r.IsDBNull(i) ? null : r.GetValue(i) switch { DateOnly x => x.ToString("yyyy-MM-dd"), var v => v };
                }
                return d;
            }, ct, Tenant, employeeId);
        }

        var bundle = new Dictionary<string, object?>
        {
            ["hazirlanma"] = DateTime.UtcNow,
            ["aciklama"] = "KVKK m.11 kapsamında, HR360'ta sizinle ilişkili tutulan kişisel verilerin dökümüdür.",
            ["calisan"] = await Rows("employee_employees", "\"Id\" = $2"),
            ["gorevlendirmeler"] = await Rows("employee_assignments", "\"EmployeeId\" = $2", "\"EffectiveFrom\""),
            ["profil"] = (await Rows("engagement_profiles", "\"EmployeeId\" = $2")).Select(OpenPii).ToList(),
            ["izinTalepleri"] = await Rows("leave_requests", "\"EmployeeId\" = $2", "\"StartDate\""),
            ["izinBakiyeleri"] = await Rows("leave_balances", "\"EmployeeId\" = $2", "\"Year\""),
            ["puantaj"] = await Rows("timeshift_time_entries", "\"EmployeeId\" = $2", "\"Date\""),
            ["masraflar"] = await Rows("expense_claims", "\"EmployeeId\" = $2", "\"CreatedAt\""),
            ["performansHedefleri"] = await Rows("performance_goals", "\"EmployeeId\" = $2"),
            ["performansDegerlendirmeleri"] = await Rows("performance_reviews", "\"EmployeeId\" = $2"),
            ["egitimKayitlari"] = await Rows("learning_enrollments", "\"EmployeeId\" = $2"),
            ["sertifikalar"] = await Rows("learning_certifications", "\"EmployeeId\" = $2"),
            ["onboarding"] = await Rows("onboarding_plans", "\"EmployeeId\" = $2"),
            ["zimmetler"] = await Rows("onboarding_asset_assignments", "\"EmployeeId\" = $2"),
            ["aldigiTakdirler"] = await Rows("engagement_kudos", "\"ToEmployeeId\" = $2"),
            ["bildirimler"] = await Rows("notification_messages", "\"RecipientEmployeeId\" = $2", "\"CreatedAt\" DESC"),
        };
        if (Me.IsHr || me?.Id == employeeId)
            bundle["ucretGecmisi"] = await Rows("compensation_records", "\"EmployeeId\" = $2", "\"EffectiveFrom\"");
        if (person.UserId is not null)
            bundle["onaylar"] = await _db.Consents.AsNoTracking().Where(c => c.UserId == person.UserId).OrderBy(c => c.RecordedAt).ToListAsync(ct);

        await Db.ExecuteAsync("""
            INSERT INTO audit_log ("TenantSlug","Service","EntityType","EntityId","Action","Changes","UserId","UserName","CorrelationId","OccurredAt")
            VALUES ($1,'governance-service','PersonalDataExport',$2,'Exported','{}'::jsonb,$3,$4,$5,now())
            """, ct, Tenant, employeeId.ToString(), Me.UserId, Me.Name, Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? HttpContext.TraceIdentifier);

        var json = JsonSerializer.SerializeToUtf8Bytes(bundle, new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        return File(json, "application/json", $"kisisel-veri-{person.Name.Replace(' ', '-').ToLowerInvariant()}-{DateTime.UtcNow:yyyyMMdd}.json");
    }

    /// <summary>engagement-service'in şifrelediği TCKN/IBAN'ı döküm için açar.</summary>
    private static Dictionary<string, object?> OpenPii(Dictionary<string, object?> row)
    {
        foreach (var k in new[] { "Iban", "NationalId" })
            if (row.TryGetValue(k, out var v) && v is string sv && sv.StartsWith("enc1:", StringComparison.Ordinal))
                row[k] = SecretBox.Unprotect(sv[5..]);
        return row;
    }

    [HttpPost("anonymize/{employeeId:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Anonymize(Guid employeeId, CancellationToken ct)
    {
        var n = await Infrastructure.Retention.AnonymizeEmployeesAsync(Db, Tenant, employeeId, 0, ct);
        if (n == 0) return BadRequest(new { message = "Yalnızca işten ayrılmış (Terminated) çalışanlar anonimleştirilebilir." });
        Infrastructure.Retention.Log(_db, Tenant, "TerminatedEmployees", "Anonymize", n, 0, "Manual", Me.Name);
        await _db.SaveChangesAsync(ct);
        await Db.ExecuteAsync("""
            INSERT INTO audit_log ("TenantSlug","Service","EntityType","EntityId","Action","Changes","UserId","UserName","OccurredAt")
            VALUES ($1,'governance-service','Employee',$2,'Anonymized','{}'::jsonb,$3,$4,now())
            """, ct, Tenant, employeeId.ToString(), Me.UserId, Me.Name);
        return Ok(new { anonymized = n });
    }

    /* ---------------------------------------------------------- saklama politikaları */

    [HttpGet("retention")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> Retention(CancellationToken ct)
    {
        var existing = await _db.RetentionPolicies.ToListAsync(ct);
        foreach (var (cat, meta) in Infrastructure.Retention.Categories)
            if (existing.All(p => p.Category != cat))
                _db.RetentionPolicies.Add(new RetentionPolicy { Category = cat, RetentionMonths = meta.DefaultMonths, Action = meta.Actions[0], IsEnabled = false });
        await _db.SaveChangesAsync(ct);
        var all = await _db.RetentionPolicies.AsNoTracking().OrderBy(p => p.Category).ToListAsync(ct);
        return Ok(all.Select(p => new
        {
            p.Id, p.Category, label = Infrastructure.Retention.Categories.GetValueOrDefault(p.Category).Label,
            allowedActions = Infrastructure.Retention.Categories.GetValueOrDefault(p.Category).Actions,
            p.RetentionMonths, p.Action, p.IsEnabled, p.LastRunAt, p.LastAffected,
        }));
    }

    public record RetentionInput(int RetentionMonths, string Action, bool IsEnabled);

    [HttpPut("retention/{id:guid}")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> UpdateRetention(Guid id, RetentionInput body, CancellationToken ct)
    {
        var p = await _db.RetentionPolicies.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return NotFound();
        var meta = Infrastructure.Retention.Categories.GetValueOrDefault(p.Category);
        if (meta.Actions is null || !meta.Actions.Contains(body.Action)) return BadRequest(new { message = "Bu kategori için geçersiz işlem." });
        if (body.RetentionMonths is < 1 or > 240) return BadRequest(new { message = "Süre 1–240 ay olmalı." });
        p.RetentionMonths = body.RetentionMonths;
        p.Action = body.Action;
        p.IsEnabled = body.IsEnabled;
        await _db.SaveChangesAsync(ct);
        return Ok(p);
    }

    [HttpPost("retention/{id:guid}/run")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> RunRetention(Guid id, CancellationToken ct)
    {
        var p = await _db.RetentionPolicies.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return NotFound();
        p.LastAffected = await Infrastructure.Retention.RunAsync(Db, p, ct);
        p.LastRunAt = DateTime.UtcNow;
        Infrastructure.Retention.Log(_db, Tenant, p.Category, p.Action, p.LastAffected, p.RetentionMonths, "Manual", Me.Name);
        await _db.SaveChangesAsync(ct);
        return Ok(new { affected = p.LastAffected });
    }
}

/* ======================================================================
 * Belge şablonları + toplu üretim. Şablon {{calisan.adSoyad}} gibi yer
 * tutucular içerir; render ucu seçilen her çalışan için doldurulmuş HTML
 * döner, arayüz bunları sayfa sonlarıyla birleştirip PDF olarak yazdırır.
 * ==================================================================== */
[Route("api/documents/templates")]
[Authorize(Policy = "RequireHrAdmin")]
[RequiresPlan("Standard")]
public class DocumentTemplatesController : AppController
{
    public static readonly (string Key, string Label)[] Placeholders =
    {
        ("calisan.adSoyad", "Ad soyad"), ("calisan.ad", "Ad"), ("calisan.soyad", "Soyad"), ("calisan.eposta", "E-posta"),
        ("calisan.telefon", "Telefon"), ("calisan.pozisyon", "Pozisyon"), ("calisan.departman", "Departman"),
        ("calisan.iseGiris", "İşe giriş tarihi"), ("calisan.kidemYil", "Kıdem (yıl)"), ("calisan.yoneticisi", "Departman yöneticisi"),
        ("izin.kalanYillik", "Kalan yıllık izin"), ("ucret.brut", "Güncel brüt ücret"),
        ("sirket.ad", "Şirket adı"), ("sirket.vergiNo", "Vergi no"), ("bugun", "Bugünün tarihi"), ("belge.no", "Belge numarası"),
    };

    private readonly GovernanceDbContext _db;
    public DocumentTemplatesController(GovernanceDbContext db) => _db = db;

    [HttpGet("placeholders")]
    public IActionResult GetPlaceholders() => Ok(Placeholders.Select(p => new { key = p.Key, label = p.Label }));

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct) =>
        Ok(await _db.DocTemplates.AsNoTracking().OrderBy(t => t.Category).ThenBy(t => t.Name).ToListAsync(ct));

    public record TemplateInput(string Name, string Category, string Body);

    [HttpPost]
    public async Task<IActionResult> Create(TemplateInput body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Name) || string.IsNullOrWhiteSpace(body.Body)) return BadRequest(new { message = "Ad ve içerik zorunlu." });
        var t = new DocTemplate { Name = body.Name.Trim(), Category = body.Category?.Trim() is { Length: > 0 } c ? c : "Genel", Body = Sanitize(body.Body) };
        _db.DocTemplates.Add(t);
        await _db.SaveChangesAsync(ct);
        return Ok(t);
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, TemplateInput body, CancellationToken ct)
    {
        var t = await _db.DocTemplates.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return NotFound();
        t.Name = body.Name.Trim();
        t.Category = body.Category?.Trim() is { Length: > 0 } c ? c : t.Category;
        t.Body = Sanitize(body.Body);
        t.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(t);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id, CancellationToken ct)
    {
        var t = await _db.DocTemplates.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return NotFound();
        _db.DocTemplates.Remove(t);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    [HttpPost("samples")]
    public async Task<IActionResult> Samples(CancellationToken ct)
    {
        var have = await _db.DocTemplates.Select(t => t.Name).ToListAsync(ct);
        var samples = new (string Name, string Cat, string Body)[]
        {
            ("Çalışma belgesi", "Resmî yazılar", """
                <h2 style="text-align:center">ÇALIŞMA BELGESİ</h2>
                <p>Şirketimiz <b>{{sirket.ad}}</b> bünyesinde <b>{{calisan.adSoyad}}</b>, <b>{{calisan.iseGiris}}</b> tarihinden bu yana
                <b>{{calisan.departman}}</b> biriminde <b>{{calisan.pozisyon}}</b> olarak çalışmaktadır.</p>
                <p>Bu belge, ilgilinin talebi üzerine 4857 sayılı İş Kanunu'nun 28. maddesi kapsamında düzenlenmiştir.</p>
                <p style="margin-top:48px">{{bugun}}<br/>Belge no: {{belge.no}}</p><p style="text-align:right">İnsan Kaynakları<br/>{{sirket.ad}}</p>
                """),
            ("Görev değişikliği bildirimi", "Çalışan yazışmaları", """
                <p>Sayın {{calisan.adSoyad}},</p>
                <p>{{bugun}} itibarıyla <b>{{calisan.departman}}</b> biriminde <b>{{calisan.pozisyon}}</b> görevinde çalışmaya devam edeceğinizi bildiririz.
                Yöneticiniz: {{calisan.yoneticisi}}.</p><p>Yeni görevinizde başarılar dileriz.</p><p>{{sirket.ad}} — İnsan Kaynakları</p>
                """),
            ("Yıllık izin hatırlatması", "Çalışan yazışmaları", """
                <p>Merhaba {{calisan.ad}},</p><p>{{bugun}} itibarıyla <b>{{izin.kalanYillik}} gün</b> kullanılmamış yıllık izniniz bulunmaktadır.
                Dinlenme hakkınızı yıl içine yaymanızı öneririz.</p><p>İK ekibi</p>
                """),
            ("Ücret bilgilendirme yazısı", "Gizli", """
                <p>Sayın {{calisan.adSoyad}},</p><p>{{bugun}} itibarıyla güncel aylık brüt ücretiniz <b>{{ucret.brut}}</b> olarak belirlenmiştir.</p>
                <p>Bu yazı kişiye özeldir.</p><p>{{sirket.ad}}</p>
                """),
        };
        var added = 0;
        foreach (var s in samples.Where(s => !have.Contains(s.Name)))
        {
            _db.DocTemplates.Add(new DocTemplate { Name = s.Name, Category = s.Cat, Body = s.Body.Trim() });
            added++;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(new { added });
    }

    public record RenderInput(List<Guid> EmployeeIds);

    [HttpPost("{id:guid}/render")]
    public async Task<IActionResult> Render(Guid id, RenderInput body, CancellationToken ct)
    {
        var t = await _db.DocTemplates.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (t is null) return NotFound();
        if (body.EmployeeIds.Count is 0 or > 500) return BadRequest(new { message = "1–500 çalışan seçin." });
        var people = (await People.ListAsync(Tenant, ct, includeTerminated: true)).ToDictionary(p => p.Id);
        var company = (await Db.QueryAsync("SELECT \"Name\", \"TaxNumber\" FROM platform_tenants WHERE \"Slug\" = $1",
            r => (Name: r.GetString(0), Tax: r.Str(1)), ct, Tenant)).FirstOrDefault();
        var ids = body.EmployeeIds.ToArray();
        var phones = (await Db.QueryAsync("SELECT \"Id\", \"Phone\" FROM employee_employees WHERE \"TenantSlug\" = $1 AND \"Id\" = ANY($2)",
            r => (Id: r.GetGuid(0), Phone: r.Str(1)), ct, Tenant, ids)).ToDictionary(x => x.Id, x => x.Phone);
        var leave = (await Db.QueryAsync("""
            SELECT "EmployeeId", sum("EntitledDays" - "UsedDays") FROM leave_balances
            WHERE "TenantSlug" = $1 AND "EmployeeId" = ANY($2) AND "Type" = 'Annual' AND "Year" = $3 GROUP BY 1
            """, r => (Id: r.GetGuid(0), Days: r.Dec(1) ?? 0), ct, Tenant, ids, DateTime.UtcNow.Year)).ToDictionary(x => x.Id, x => x.Days);
        var canSeePay = Me.IsHr || Me.Roles.Contains("ext-compensation-view");
        var pay = canSeePay
            ? (await Db.QueryAsync("""
                SELECT DISTINCT ON ("EmployeeId") "EmployeeId", "BaseSalary", "Currency" FROM compensation_records
                WHERE "TenantSlug" = $1 AND "EmployeeId" = ANY($2) ORDER BY "EmployeeId", "EffectiveFrom" DESC
                """, r => (Id: r.GetGuid(0), Pay: r.GetDecimal(1), Cur: r.Str(2) ?? "TRY"), ct, Tenant, ids)).ToDictionary(x => x.Id)
            : new();
        var tr = new System.Globalization.CultureInfo("tr-TR");
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(3));
        var docs = new List<object>();
        var seq = 0;
        foreach (var eid in body.EmployeeIds.Distinct())
        {
            if (!people.TryGetValue(eid, out var p)) continue;
            var head = p.DepartmentHeadId is { } h && people.TryGetValue(h, out var hp) ? hp.Name : "—";
            var parts = p.Name.Split(' ', 2);
            var values = new Dictionary<string, string>
            {
                ["calisan.adSoyad"] = p.Name, ["calisan.ad"] = parts[0], ["calisan.soyad"] = parts.Length > 1 ? parts[1] : "",
                ["calisan.eposta"] = p.Email ?? "—", ["calisan.telefon"] = phones.GetValueOrDefault(p.Id) ?? "—",
                ["calisan.pozisyon"] = p.Position ?? "—", ["calisan.departman"] = p.Department ?? "—",
                ["calisan.iseGiris"] = p.HireDate.ToString("dd.MM.yyyy"),
                ["calisan.kidemYil"] = Math.Round((today.DayNumber - p.HireDate.DayNumber) / 365.25, 1).ToString(tr),
                ["calisan.yoneticisi"] = head,
                ["izin.kalanYillik"] = leave.GetValueOrDefault(p.Id).ToString("0.#", tr),
                ["ucret.brut"] = pay.TryGetValue(p.Id, out var pr) ? pr.Pay.ToString("N2", tr) + " " + pr.Cur : "—",
                ["sirket.ad"] = company.Name ?? Tenant, ["sirket.vergiNo"] = company.Tax ?? "—",
                ["bugun"] = today.ToString("dd.MM.yyyy"), ["belge.no"] = $"{DateTime.UtcNow:yyMMdd}-{++seq:000}",
            };
            var html = Regex.Replace(t.Body, @"\{\{\s*([\w.]+)\s*\}\}", m => values.TryGetValue(m.Groups[1].Value, out var v) ? WebUtility.HtmlEncode(v) : m.Value);
            docs.Add(new { employeeId = p.Id, name = p.Name, html });
        }
        return Ok(new { template = t.Name, documents = docs });
    }

    /// <summary>Şablon HTML'inde betik ve olay öznitelikleri kabul edilmez.</summary>
    private static string Sanitize(string html)
    {
        var s = Regex.Replace(html, @"<\s*(script|iframe|object|embed|style)[^>]*>.*?<\s*/\s*\1\s*>", "", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        s = Regex.Replace(s, @"<\s*(script|iframe|object|embed)[^>]*/?>", "", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"\son\w+\s*=\s*(""[^""]*""|'[^']*'|[^\s>]+)", "", RegexOptions.IgnoreCase);
        s = Regex.Replace(s, @"javascript\s*:", "", RegexOptions.IgnoreCase);
        return s.Trim();
    }
}
