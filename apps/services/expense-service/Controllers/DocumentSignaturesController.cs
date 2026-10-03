using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Models;
using ExpenseService.Services;
using ExpenseService.Tenancy;

namespace ExpenseService.Controllers;

/// <summary>
/// Y28: OTP ile basit elektronik imza. IK bir ozluk dokumanini calisana imzaya gonderir;
/// calisan dokumani gorur, 6 haneli tek kullanimlik kod ister (uygulama ici bildirim + e-posta
/// kanali satiri) ve kodla onaylar. Kod yalnizca HMAC ozetiyle saklanir, 10 dk gecerlidir,
/// en fazla 5 deneme. Basarili imzada degistirilemez kanit kaydi olusur.
///
/// Basit elektronik imza — 5070 sayili Kanun kapsaminda nitelikli (guvenli) elektronik imza
/// DEGILDIR. Yanitlarin hepsinde "disclaimer" alani bulunur.
/// </summary>
[ApiController]
[Route("api/documents")]
[Authorize]
public class DocumentSignaturesController : ControllerBase
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly ExpenseDbContext _db;
    private readonly ApprovalWorkflowClient _employees;
    private readonly ITenantContext _tenant;
    private readonly ILogger<DocumentSignaturesController> _log;

    public DocumentSignaturesController(ExpenseDbContext db, ApprovalWorkflowClient employees, ITenantContext tenant,
        ILogger<DocumentSignaturesController> log)
    {
        _db = db;
        _employees = employees;
        _tenant = tenant;
        _log = log;
    }

    private string? UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("sub")?.Value;
    private string? UserName => User.FindFirst("preferred_username")?.Value ?? User.FindFirst("name")?.Value;
    private string Tenant => _tenant.TenantSlug ?? "";
    private string? ClientIp => Request.Headers["X-Real-IP"].FirstOrDefault() ?? HttpContext.Connection.RemoteIpAddress?.ToString();

    private bool CanManage =>
        User.IsInRole("hr-admin") || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin") || User.IsInRole("ext-document-manage");

    private IActionResult Fail(int status, string message, string? code = null) =>
        StatusCode(status, new { message, code, disclaimer = SimpleSignature.Disclaimer });

    private async Task AuditAsync(string entityType, string entityId, string action, object changes)
    {
        try
        {
            await _db.Database.ExecuteSqlRawAsync(
                "INSERT INTO audit_log (\"TenantSlug\",\"Service\",\"EntityType\",\"EntityId\",\"Action\",\"Changes\",\"UserId\",\"UserName\",\"CorrelationId\",\"IpAddress\",\"OccurredAt\") " +
                "VALUES (@tenant,'expense-service',@type,@id,@action,@changes::jsonb,@uid,@uname,@corr,@ip,now())",
                new object[]
                {
                    Param("tenant", _tenant.TenantSlug), Param("type", entityType), Param("id", entityId), Param("action", action),
                    Param("changes", JsonSerializer.Serialize(changes, Json)), Param("uid", UserId), Param("uname", UserName),
                    Param("corr", Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? HttpContext.TraceIdentifier),
                    Param("ip", SimpleSignature.MaskIp(ClientIp)),
                });
        }
        catch (Exception ex) { _log.LogWarning("Denetim kaydi yazilamadi: {Message}", ex.Message); }
    }

    /// <summary>Bildirim (uygulama ici ya da e-posta kanali satiri). Kisisel veri yalnizca gerekli kadar.</summary>
    private async Task NotifyAsync(Guid employeeId, string channel, string? email, string subject, string body, string code,
        string? actionUrl, CancellationToken ct)
    {
        try
        {
            // NOT: ham SQL'de DBNull.Value tur eslemesi bulamiyor; null degerler tipli Npgsql parametresiyle gecer.
            await _db.Database.ExecuteSqlRawAsync("""
                INSERT INTO notification_messages ("Id","TenantSlug","RecipientEmployeeId","RecipientEmail","Channel","TemplateCode","Subject","Body","Status","AttemptCount","CreatedAt","ActionUrl","ActionLabel")
                VALUES (@id,@tenant,@emp,@email,@channel,@code,@subject,@body,'Pending',0,now(),@url,@label)
                """, new object[]
                {
                    Param("id", Guid.NewGuid(), NpgsqlTypes.NpgsqlDbType.Uuid), Param("tenant", Tenant), Param("emp", employeeId, NpgsqlTypes.NpgsqlDbType.Uuid),
                    Param("email", email), Param("channel", channel), Param("code", code), Param("subject", subject), Param("body", body),
                    Param("url", actionUrl), Param("label", actionUrl is null ? null : "Belgeyi aç"),
                }, ct);
        }
        catch (Exception ex) { _log.LogWarning("Bildirim yazilamadi: {Message}", ex.Message); }
    }

    private static Npgsql.NpgsqlParameter Param(string name, object? value, NpgsqlTypes.NpgsqlDbType type = NpgsqlTypes.NpgsqlDbType.Text) =>
        new(name, type) { Value = value ?? DBNull.Value };

    private async Task<string?> EmployeeEmailAsync(Guid employeeId, CancellationToken ct)
    {
        try
        {
            return await _db.Database.SqlQuery<string>($@"SELECT ""Email"" AS ""Value"" FROM employee_employees
                    WHERE ""Id"" = {employeeId} AND ""TenantSlug"" = {Tenant} LIMIT 1").FirstOrDefaultAsync(ct);
        }
        catch (Exception) { return null; }
    }

    private static object DocView(Document d) => new
    {
        d.Id, d.EmployeeId, type = d.Type.ToString(), d.FileName, d.StorageKey, d.SizeBytes, d.ContentType, d.UploadedAt, d.SignedAt,
        contentHash = SimpleSignature.DocumentHash(d),
    };

    private static object EvidenceView(SignatureEvidence e) => new
    {
        e.Id, e.SignatureId, e.DocumentId, e.SignerEmployeeId, e.SignedAt, documentHash = e.DocumentHash, e.IpMasked,
        e.UserAgentHash, e.OtpChannel, e.Method, e.EvidenceHash,
        // Butunluk: kayitli alanlardan yeniden hesaplanan ozet saklanan ozetle ayni mi.
        integrityOk = SimpleSignature.EvidenceHash(e) == e.EvidenceHash,
    };

    private static object RequestView(DocumentSignature s, Document? d, SignatureEvidence? e) => new
    {
        s.Id, s.DocumentId, s.EmployeeId, s.Status, s.Message, s.CreatedAt, s.SignedAt, s.CancelledAt,
        requestedDocumentHash = s.DocumentHash,
        otp = new
        {
            sent = s.OtpHash is not null, channel = s.OtpChannel, expiresAt = s.OtpExpiresAt,
            attemptsLeft = Math.Max(0, SimpleSignature.MaxAttempts - s.OtpAttempts),
            sendsLeft = Math.Max(0, SimpleSignature.MaxSends - s.OtpSentCount),
        },
        document = d is null ? null : DocView(d),
        evidence = e is null ? null : EvidenceView(e),
        disclaimer = SimpleSignature.Disclaimer,
    };

    /* ------------------------------------------------------------ IK: imzaya gonder */

    public record SignatureRequestInput(string? Message);

    [HttpPost("{id:guid}/signature-requests")]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> CreateRequest(Guid id, [FromBody] SignatureRequestInput? body, CancellationToken ct)
    {
        var doc = await _db.Documents.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return Fail(404, "Doküman bulunamadı");
        if (doc.EmployeeId == Guid.Empty) return Fail(400, "Dokümanın bağlı olduğu çalışan yok");
        if (await _db.DocumentSignatures.AnyAsync(s => s.DocumentId == id && s.Status == SignatureStatus.Pending, ct))
            return Fail(409, "Bu doküman için bekleyen bir imza talebi zaten var", "pending_exists");
        var message = string.IsNullOrWhiteSpace(body?.Message) ? null : body!.Message!.Trim();
        if (message is { Length: > 500 }) return Fail(400, "Not en fazla 500 karakter olabilir");

        var sig = new DocumentSignature
        {
            DocumentId = doc.Id,
            EmployeeId = doc.EmployeeId,
            DocumentHash = SimpleSignature.DocumentHash(doc),
            Message = message,
            RequestedByEmployeeId = await _employees.FindMyEmployeeIdAsync(ct),
            RequestedByUserId = UserId,
        };
        _db.DocumentSignatures.Add(sig);
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateException) { return Fail(409, "Bu doküman için bekleyen bir imza talebi zaten var", "pending_exists"); }

        await NotifyAsync(doc.EmployeeId, "InApp", null, "İmzanızı bekleyen bir belge var",
            "İK bir belgeyi basit elektronik imzanıza gönderdi. Belgeyi İmzalarım sayfasında inceleyip tek kullanımlık kodla imzalayabilirsiniz.",
            "document.sign.request", "/panel/imzalarim", ct);
        return Ok(RequestView(sig, doc, null));
    }

    /// <summary>Dokumanin tum imza talepleri ve kanitlari (IK).</summary>
    [HttpGet("{id:guid}/signatures")]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> ForDocument(Guid id, CancellationToken ct)
    {
        var doc = await _db.Documents.FirstOrDefaultAsync(d => d.Id == id, ct);
        if (doc is null) return Fail(404, "Doküman bulunamadı");
        var rows = await _db.DocumentSignatures.Where(s => s.DocumentId == id).OrderByDescending(s => s.CreatedAt).ToListAsync(ct);
        var ids = rows.Select(r => r.Id).ToList();
        var ev = await _db.SignatureEvidence.Where(e => ids.Contains(e.SignatureId)).ToDictionaryAsync(e => e.SignatureId, ct);
        if (ev.Count > 0)
            await AuditAsync("SignatureEvidence", id.ToString(), "SensitiveViewed", new { field = "signatureEvidence", count = ev.Count });
        return Ok(new
        {
            document = DocView(doc),
            items = rows.Select(r => RequestView(r, null, ev.GetValueOrDefault(r.Id))),
            disclaimer = SimpleSignature.Disclaimer,
        });
    }

    /// <summary>Durum ozeti (dokuman listesinde rozet icin): dokuman -> son talep durumu.</summary>
    [HttpGet("signature-status")]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> StatusSummary([FromQuery] Guid? employeeId, CancellationToken ct)
    {
        var q = _db.DocumentSignatures.AsQueryable();
        if (employeeId.HasValue) q = q.Where(s => s.EmployeeId == employeeId.Value);
        var rows = await q.Select(s => new { s.DocumentId, s.Id, s.Status, s.CreatedAt, s.SignedAt }).ToListAsync(ct);
        return Ok(rows.GroupBy(r => r.DocumentId).Select(g =>
        {
            var last = g.OrderByDescending(x => x.CreatedAt).First();
            return new { documentId = g.Key, signatureId = last.Id, status = last.Status, signedAt = g.Max(x => x.SignedAt) };
        }));
    }

    [HttpDelete("signature-requests/{sid:guid}")]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> Cancel(Guid sid, CancellationToken ct)
    {
        var s = await _db.DocumentSignatures.FirstOrDefaultAsync(x => x.Id == sid, ct);
        if (s is null) return Fail(404, "İmza talebi bulunamadı");
        if (s.Status != SignatureStatus.Pending) return Fail(409, "Yalnızca bekleyen talepler iptal edilebilir");
        s.Status = SignatureStatus.Cancelled;
        s.CancelledAt = DateTimeOffset.UtcNow;
        s.OtpHash = null;
        await _db.SaveChangesAsync(ct);
        return Ok(new { message = "İmza talebi iptal edildi", disclaimer = SimpleSignature.Disclaimer });
    }

    /* ------------------------------------------------------------ calisan: imzalarim */

    private async Task<(DocumentSignature? Sig, IActionResult? Error)> MineAsync(Guid sid, CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return (null, Fail(403, "Çalışan kaydınız bulunamadı"));
        var s = await _db.DocumentSignatures.FirstOrDefaultAsync(x => x.Id == sid, ct);
        // Baskasinin talebi varligi da sizdirilmasin: 404.
        if (s is null || s.EmployeeId != me.Value) return (null, Fail(404, "İmza talebi bulunamadı"));
        return (s, null);
    }

    [HttpGet("signature-requests/mine")]
    public async Task<IActionResult> Mine(CancellationToken ct)
    {
        var me = await _employees.FindMyEmployeeIdAsync(ct);
        if (me is null) return Ok(new { items = Array.Empty<object>(), disclaimer = SimpleSignature.Disclaimer });
        var rows = await _db.DocumentSignatures.Where(s => s.EmployeeId == me.Value && s.Status != SignatureStatus.Cancelled)
            .OrderByDescending(s => s.CreatedAt).Take(200).ToListAsync(ct);
        var docIds = rows.Select(r => r.DocumentId).Distinct().ToList();
        var docs = await _db.Documents.Where(d => docIds.Contains(d.Id)).ToDictionaryAsync(d => d.Id, ct);
        var sids = rows.Select(r => r.Id).ToList();
        var ev = await _db.SignatureEvidence.Where(e => sids.Contains(e.SignatureId)).ToDictionaryAsync(e => e.SignatureId, ct);
        return Ok(new
        {
            items = rows.Where(r => docs.ContainsKey(r.DocumentId))
                .Select(r => RequestView(r, docs[r.DocumentId], ev.GetValueOrDefault(r.Id))),
            disclaimer = SimpleSignature.Disclaimer,
        });
    }

    [HttpGet("signature-requests/{sid:guid}")]
    public async Task<IActionResult> Get(Guid sid, CancellationToken ct)
    {
        DocumentSignature? s;
        if (CanManage)
            s = await _db.DocumentSignatures.FirstOrDefaultAsync(x => x.Id == sid, ct);
        else
        {
            var (mine, err) = await MineAsync(sid, ct);
            if (err is not null) return err;
            s = mine;
        }
        if (s is null) return Fail(404, "İmza talebi bulunamadı");
        var doc = await _db.Documents.FirstOrDefaultAsync(d => d.Id == s.DocumentId, ct);
        var ev = await _db.SignatureEvidence.FirstOrDefaultAsync(e => e.SignatureId == s.Id, ct);
        return Ok(RequestView(s, doc, ev));
    }

    /// <summary>Tek kullanimlik kod gonderir (uygulama ici bildirim + e-posta kanali satiri).</summary>
    [HttpPost("signature-requests/{sid:guid}/otp")]
    public async Task<IActionResult> SendOtp(Guid sid, CancellationToken ct)
    {
        var (s, err) = await MineAsync(sid, ct);
        if (err is not null) return err;
        if (s!.Status != SignatureStatus.Pending) return Fail(409, "Bu talep artık imzalanamaz", "not_pending");
        var now = DateTimeOffset.UtcNow;
        if (s.OtpSentCount >= SimpleSignature.MaxSends)
            return Fail(429, "Bu talep için kod gönderme sınırına ulaşıldı; İK'dan yeni talep isteyin", "send_limit");
        if (s.OtpLastSentAt is { } last && now - last < SimpleSignature.ResendCooldown)
            return Fail(429, "Yeni kod için lütfen biraz bekleyin", "cooldown");

        var code = SimpleSignature.NewOtp();
        var email = await EmployeeEmailAsync(s.EmployeeId, ct);
        s.OtpHash = SimpleSignature.HashOtp(s.Id, code);
        s.OtpExpiresAt = now + SimpleSignature.OtpLifetime;
        s.OtpAttempts = 0;
        s.OtpSentCount++;
        s.OtpLastSentAt = now;
        s.OtpChannel = email is null ? "InApp" : "InApp+Email";
        await _db.SaveChangesAsync(ct);

        const string subject = "Belge imza doğrulama kodu";
        var body = $"Belge imzalama kodunuz: {code}. Kod 10 dakika geçerlidir. Kodu kimseyle paylaşmayın; İK dahil kimse sizden bu kodu istemez.";
        await NotifyAsync(s.EmployeeId, "InApp", null, subject, body, "document.sign.otp", "/panel/imzalarim", ct);
        if (email is not null)
            await NotifyAsync(s.EmployeeId, "Email", email, subject, body, "document.sign.otp", null, ct);
        return Ok(new
        {
            message = "Doğrulama kodu bildirimlerinize gönderildi",
            channel = s.OtpChannel,
            expiresAt = s.OtpExpiresAt,
            attemptsLeft = SimpleSignature.MaxAttempts,
            sendsLeft = SimpleSignature.MaxSends - s.OtpSentCount,
            disclaimer = SimpleSignature.Disclaimer,
        });
    }

    public record SignInput(string? Code, bool Accept);

    [HttpPost("signature-requests/{sid:guid}/sign")]
    public async Task<IActionResult> Sign(Guid sid, [FromBody] SignInput body, CancellationToken ct)
    {
        var (s, err) = await MineAsync(sid, ct);
        if (err is not null) return err;
        if (!body.Accept) return Fail(400, "İmzalamak için belgeyi okuduğunuzu ve basit elektronik imza açıklamasını onaylamalısınız");
        if (s!.Status != SignatureStatus.Pending) return Fail(409, "Bu talep artık imzalanamaz", "not_pending");
        var now = DateTimeOffset.UtcNow;
        switch (SimpleSignature.Check(s, body.Code, now))
        {
            case SimpleSignature.OtpCheck.NoCode:
                return Fail(400, "Önce doğrulama kodu isteyin", "no_code");
            case SimpleSignature.OtpCheck.TooManyAttempts:
                return Fail(429, "Deneme hakkınız doldu; yeni kod isteyin", "too_many_attempts");
            case SimpleSignature.OtpCheck.Expired:
                s.OtpHash = null;
                await _db.SaveChangesAsync(ct);
                return Fail(410, "Kodun süresi doldu; yeni kod isteyin", "expired");
            case SimpleSignature.OtpCheck.BadFormat:
            case SimpleSignature.OtpCheck.Wrong:
                s.OtpAttempts++;
                if (s.OtpAttempts >= SimpleSignature.MaxAttempts) s.OtpHash = null;
                await _db.SaveChangesAsync(ct);
                await AuditAsync("DocumentSignature", s.Id.ToString(), "OtpFailed", new { attempts = s.OtpAttempts });
                var left = Math.Max(0, SimpleSignature.MaxAttempts - s.OtpAttempts);
                return left == 0
                    ? Fail(429, "Kod hatalı. Deneme hakkınız doldu; yeni kod isteyin", "too_many_attempts")
                    : Fail(400, $"Kod hatalı. Kalan deneme: {left}", "wrong_code");
        }

        var doc = await _db.Documents.FirstOrDefaultAsync(d => d.Id == s.DocumentId, ct);
        if (doc is null) return Fail(404, "Doküman bulunamadı");
        var hash = SimpleSignature.DocumentHash(doc);
        if (hash != s.DocumentHash)
            return Fail(409, "Belge imzaya gönderildikten sonra değişti; İK'dan yeni talep isteyin", "document_changed");

        var evidence = new SignatureEvidence
        {
            TenantSlug = Tenant,
            SignatureId = s.Id,
            DocumentId = doc.Id,
            SignerEmployeeId = s.EmployeeId,
            SignedAt = DateTimeOffset.FromUnixTimeMilliseconds(now.ToUnixTimeMilliseconds()),
            DocumentHash = hash,
            IpMasked = SimpleSignature.MaskIp(ClientIp),
            UserAgentHash = SimpleSignature.HashUserAgent(Request.Headers.UserAgent.ToString()),
            OtpChannel = s.OtpChannel ?? "InApp",
            EvidenceHash = "",
        };
        evidence.EvidenceHash = SimpleSignature.EvidenceHash(evidence);
        _db.SignatureEvidence.Add(evidence);
        s.Status = SignatureStatus.Signed;
        s.SignedAt = evidence.SignedAt;
        s.OtpHash = null;
        // Ilk imza dokumani kilitler (sonraki yeniden imzalar kilidi degistirmez).
        if (doc.SignedAt is null) doc.SignedAt = evidence.SignedAt;
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateException)
        {
            return Fail(409, "Bu talep zaten imzalandı", "not_pending");
        }

        if (s.RequestedByEmployeeId is { } hr && hr != s.EmployeeId)
            await NotifyAsync(hr, "InApp", null, "Belge imzalandı",
                "İmzaya gönderdiğiniz bir belge çalışan tarafından basit elektronik imzayla imzalandı.",
                "document.sign.done", "/panel/dokumanlar", ct);
        return Ok(new { message = "Belge imzalandı", evidence = EvidenceView(evidence), disclaimer = SimpleSignature.Disclaimer });
    }
}
