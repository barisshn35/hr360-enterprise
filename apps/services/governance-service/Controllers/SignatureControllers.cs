using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using GovernanceService.Data;
using GovernanceService.Infrastructure;

namespace GovernanceService.Controllers;

/* ======================================================================
 * Y28 OTP ile basit elektronik imza — düzenlenmiş belge talepleri için.
 * Çalışan kendi belgesini imzalar: 6 haneli kod uygulama içi (ya da
 * e-posta) bildirimle gelir, 10 dk geçerli, 5 deneme; kod özetlenmiş
 * saklanır. Kanıt: belge kimliği + sürüm, belge içeriğinin SHA-256'sı,
 * imzalayan çalışan, zaman, yöntem, /24 IP. Belge silinince kanıt da
 * silinir (belgenin saklama süresine bağlı).
 * "Basit elektronik imza — 5070 sayılı Kanun kapsamında güvenli/nitelikli
 * elektronik imza değildir."
 * ==================================================================== */
[Route("api/documents/requests/{id:guid}")]
[Authorize]
public class DocumentSignatureController : AppController
{
    private readonly GovernanceDbContext _db;
    private readonly Notifier _notifier;
    public DocumentSignatureController(GovernanceDbContext db, Notifier notifier) { _db = db; _notifier = notifier; }

    public sealed record Evidence(Guid Id, string DocumentType, Guid DocumentId, int DocumentVersion, string DocumentSha256, Guid SignerEmployeeId,
        DateTime SignedAt, string Method, string? IpPrefix, string Disclaimer, string EvidenceSha256);

    public static async Task<Evidence?> EvidenceAsync(Sql sql, string tenant, Guid documentId, CancellationToken ct) =>
        (await sql.QueryAsync("""
            SELECT "Id","DocumentType","DocumentId","DocumentVersion","DocumentSha256","SignerEmployeeId","SignedAt","Method","IpPrefix","Disclaimer","EvidenceSha256"
            FROM governance_signatures WHERE "TenantSlug" = $1 AND "DocumentId" = $2 ORDER BY "SignedAt" DESC LIMIT 1
            """, r => new Evidence(r.GetGuid(0), r.GetString(1), r.GetGuid(2), r.GetInt32(3), r.GetString(4), r.GetGuid(5), r.GetFieldValue<DateTime>(6),
                r.GetString(7), r.Str(8), r.GetString(9), r.GetString(10)), ct, tenant, documentId)).FirstOrDefault();

    public static object View(Evidence e, bool en) => new
    {
        e.Id, e.DocumentType, e.DocumentId, e.DocumentVersion, e.DocumentSha256, e.SignerEmployeeId, e.SignedAt, e.Method, e.IpPrefix,
        disclaimer = en ? Signatures.DisclaimerEn : e.Disclaimer, e.EvidenceSha256, kind = "simple-electronic-signature",
    };

    private async Task<(Models.DocumentRequest? Doc, Person? Me, IActionResult? Error)> OwnDocumentAsync(Guid id, CancellationToken ct)
    {
        var me = await MyPersonAsync(ct);
        var r = await _db.DocumentRequests.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (r is null || r.Status != "Issued" || r.DocumentEnc is null) return (null, me, NotFound(new { message = L("Belge bulunamadı.", "Document not found.") }));
        if (me?.Id != r.EmployeeId)
            return (null, me, StatusCode(403, new { message = L("Yalnızca belgenin sahibi imzalayabilir.", "Only the document's owner can sign it."), code = "not_owner" }));
        return (r, me, null);
    }

    public record OtpInput(string? Channel);

    /// <summary>İmza kodu ister. Önceki kullanılmamış kodlar geçersiz olur.</summary>
    [HttpPost("sign/otp")]
    public async Task<IActionResult> RequestOtp(OtpInput? body, CancellationToken ct)
    {
        var (r, me, err) = await OwnDocumentAsync(RouteId, ct);
        if (err is not null) return err;
        if (await EvidenceAsync(Db, Tenant, r!.Id, ct) is not null)
            return Conflict(new { message = L("Belge zaten imzalanmış.", "The document is already signed."), code = "already_signed" });
        var channel = body?.Channel is "Email" ? "Email" : "InApp";
        var recent = Convert.ToInt32(await Db.ScalarAsync("""
            SELECT count(*)::int FROM governance_signature_otps WHERE "TenantSlug" = $1 AND "DocumentId" = $2 AND "CreatedAt" > now() - interval '1 hour'
            """, ct, Tenant, r.Id));
        if (recent >= 5) return StatusCode(429, new { message = L("Bu belge için saatte en fazla 5 kod istenebilir.", "At most 5 codes per hour can be requested for this document."), code = "otp_rate_limited" });
        await Db.ExecuteAsync("""
            UPDATE governance_signature_otps SET "ConsumedAt" = now() WHERE "TenantSlug" = $1 AND "DocumentId" = $2 AND "ConsumedAt" IS NULL
            """, ct, Tenant, r.Id);
        var otpId = Guid.NewGuid();
        var code = Signatures.NewCode();
        var expires = DateTime.UtcNow.AddMinutes(Signatures.ValidMinutes);
        await Db.ExecuteAsync("""
            INSERT INTO governance_signature_otps ("Id","TenantSlug","DocumentId","EmployeeId","CodeHash","Channel","Attempts","ExpiresAt","CreatedAt")
            VALUES ($1,$2,$3,$4,$5,$6,0,$7,now())
            """, ct, otpId, Tenant, r.Id, me!.Id, Signatures.Hash(otpId, code), channel, expires);
        // Kod yalnızca bildirimle gider; yanıtta DÖNMEZ. Belge içeriği bildirime yazılmaz.
        var sent = await _notifier.LocalizedAsync(Tenant, me.Id, "Belge imza kodu", "Document signing code",
            $"\"{r.TemplateName}\" belgesini imzalamak için tek kullanımlık kodunuz: {code}. Kod {Signatures.ValidMinutes} dakika geçerlidir; kimseyle paylaşmayın. {Signatures.DisclaimerTr}.",
            $"Your one-time code to sign \"{r.TemplateName}\": {code}. The code is valid for {Signatures.ValidMinutes} minutes; do not share it. {Signatures.DisclaimerEn}.",
            "signature.otp", ct, channel);
        if (!sent && channel == "Email")
            return BadRequest(new { message = L("Kayıtlı e-posta adresiniz yok; uygulama içi kodu kullanın.", "You have no email address on record; use the in-app code."), code = "no_email" });
        return Ok(new { otpId, channel, expiresAt = expires, maxAttempts = Signatures.MaxAttempts, disclaimer = En ? Signatures.DisclaimerEn : Signatures.DisclaimerTr });
    }

    public record SignInput(Guid OtpId, string Code);

    [HttpPost("sign")]
    public async Task<IActionResult> Sign(SignInput body, CancellationToken ct)
    {
        var (r, me, err) = await OwnDocumentAsync(RouteId, ct);
        if (err is not null) return err;
        if (await EvidenceAsync(Db, Tenant, r!.Id, ct) is not null)
            return Conflict(new { message = L("Belge zaten imzalanmış.", "The document is already signed."), code = "already_signed" });
        var otp = (await Db.QueryAsync("""
            SELECT "CodeHash","Channel","Attempts","ExpiresAt","ConsumedAt" FROM governance_signature_otps
            WHERE "TenantSlug" = $1 AND "Id" = $2 AND "DocumentId" = $3 AND "EmployeeId" = $4
            """, x => (Hash: x.GetString(0), Channel: x.GetString(1), Attempts: x.GetInt32(2), Expires: x.GetFieldValue<DateTime>(3), Consumed: x.Ts(4)),
            ct, Tenant, body.OtpId, r.Id, me!.Id)).FirstOrDefault();
        if (otp.Hash is null) return NotFound(new { message = L("Kod bulunamadı; yeni kod isteyin.", "Code not found; request a new one."), code = "otp_not_found" });
        switch (Signatures.State(otp.Expires, otp.Attempts, otp.Consumed, DateTime.UtcNow))
        {
            case "consumed": return StatusCode(410, new { message = L("Bu kod artık geçerli değil; yeni kod isteyin.", "This code is no longer valid; request a new one."), code = "otp_used" });
            case "expired": return StatusCode(410, new { message = L("Kodun süresi doldu (10 dk); yeni kod isteyin.", "The code has expired (10 min); request a new one."), code = "otp_expired" });
            case "locked": return StatusCode(429, new { message = L("Çok fazla hatalı deneme; yeni kod isteyin.", "Too many wrong attempts; request a new code."), code = "otp_locked" });
        }
        if (!Signatures.Matches(body.OtpId, body.Code ?? "", otp.Hash))
        {
            var attempts = otp.Attempts + 1;
            await Db.ExecuteAsync("UPDATE governance_signature_otps SET \"Attempts\" = \"Attempts\" + 1 WHERE \"Id\" = $1", ct, body.OtpId);
            var left = Math.Max(0, Signatures.MaxAttempts - attempts);
            return left == 0
                ? StatusCode(429, new { message = L("Çok fazla hatalı deneme; yeni kod isteyin.", "Too many wrong attempts; request a new code."), code = "otp_locked", attemptsLeft = 0 })
                : BadRequest(new { message = L($"Kod hatalı. Kalan deneme: {left}.", $"Wrong code. Attempts left: {left}."), code = "otp_invalid", attemptsLeft = left });
        }
        // Tek kullanımlık: kodu önce tüket (eşzamanlı ikinci istek imza üretemez).
        var consumed = await Db.ExecuteAsync("UPDATE governance_signature_otps SET \"ConsumedAt\" = now() WHERE \"Id\" = $1 AND \"ConsumedAt\" IS NULL", ct, body.OtpId);
        if (consumed == 0) return StatusCode(410, new { message = L("Bu kod artık geçerli değil.", "This code is no longer valid."), code = "otp_used" });

        var html = SecretBox.Unprotect(r.DocumentEnc)!;
        var docHash = Signatures.Sha256Hex(html);
        var signedAt = DateTime.UtcNow;
        signedAt = signedAt.AddTicks(-(signedAt.Ticks % TimeSpan.TicksPerMillisecond));
        var method = otp.Channel == "Email" ? "OTP-Email" : "OTP-InApp";
        var ip = Signatures.TruncateIp(Request.Headers["X-Real-IP"].FirstOrDefault() ?? Request.Headers["X-Forwarded-For"].FirstOrDefault()
            ?? HttpContext.Connection.RemoteIpAddress?.ToString());
        const int version = 1;
        var evidenceHash = Signatures.Sha256Hex(Signatures.Canonical("DocumentRequest", r.Id, version, docHash, me.Id, signedAt, method, ip));
        var sigId = Guid.NewGuid();
        await Db.ExecuteAsync("""
            INSERT INTO governance_signatures ("Id","TenantSlug","DocumentType","DocumentId","DocumentVersion","DocumentSha256","SignerEmployeeId","SignedAt","Method","IpPrefix","Disclaimer","EvidenceSha256")
            VALUES ($1,$2,'DocumentRequest',$3,$4,$5,$6,$7,$8,$9,$10,$11)
            """, ct, sigId, Tenant, r.Id, version, docHash, me.Id, signedAt, method, ip, Signatures.DisclaimerTr, evidenceHash);
        await Db.ExecuteAsync("""
            INSERT INTO audit_log ("TenantSlug","Service","EntityType","EntityId","Action","Changes","UserId","UserName","IpAddress","OccurredAt")
            VALUES ($1,'governance-service','DocumentRequest',$2,'Signed',$3::jsonb,$4,$5,$6,now())
            """, ct, Tenant, r.Id.ToString(), JsonSerializer.Serialize(new { method, documentSha256 = docHash, evidence = evidenceHash }), Me.UserId, Me.Name, ip);
        InternalEvents.Raise(HttpContext.RequestServices, Tenant, "document.signed", new
        {
            TenantSlug = Tenant, DocumentId = r.Id, DocumentType = "DocumentRequest", TemplateName = r.TemplateName, EmployeeId = me.Id,
            SignedAt = signedAt, Method = method, DocumentSha256 = docHash,
        });
        var e = await EvidenceAsync(Db, Tenant, r.Id, ct);
        return Ok(View(e!, En));
    }

    [HttpGet("signature")]
    public async Task<IActionResult> Signature(CancellationToken ct)
    {
        var r = await _db.DocumentRequests.AsNoTracking().FirstOrDefaultAsync(x => x.Id == RouteId, ct);
        if (r is null) return NotFound();
        var me = await MyPersonAsync(ct);
        if (me?.Id != r.EmployeeId && !Me.IsHr) return NotFound();
        var e = await EvidenceAsync(Db, Tenant, r.Id, ct);
        return Ok(new { signed = e is not null, evidence = e is null ? null : View(e, En), disclaimer = En ? Signatures.DisclaimerEn : Signatures.DisclaimerTr });
    }

    private Guid RouteId => Guid.Parse((string)RouteData.Values["id"]!);
}
