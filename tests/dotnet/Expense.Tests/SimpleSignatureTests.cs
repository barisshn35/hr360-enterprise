using ExpenseService.Models;
using ExpenseService.Services;
using Xunit;

namespace Expense.Tests;

public class SimpleSignatureTests
{
    private static DocumentSignature Sig(string code, DateTimeOffset expires, int attempts = 0)
    {
        var s = new DocumentSignature { DocumentHash = new string('a', 64), OtpExpiresAt = expires, OtpAttempts = attempts };
        s.OtpHash = SimpleSignature.HashOtp(s.Id, code);
        return s;
    }

    [Fact]
    public void Otp_is_six_digits_and_random()
    {
        var codes = Enumerable.Range(0, 50).Select(_ => SimpleSignature.NewOtp()).ToList();
        Assert.All(codes, c => Assert.Matches("^[0-9]{6}$", c));
        Assert.True(codes.Distinct().Count() > 40);
    }

    [Fact]
    public void Otp_hash_is_bound_to_request_and_never_plain()
    {
        var a = Guid.NewGuid();
        var h = SimpleSignature.HashOtp(a, "123456");
        Assert.Equal(64, h.Length);
        Assert.DoesNotContain("123456", h);
        Assert.NotEqual(h, SimpleSignature.HashOtp(Guid.NewGuid(), "123456"));
        Assert.Equal(h, SimpleSignature.HashOtp(a, "123456"));
    }

    [Fact]
    public void Check_accepts_correct_code_within_lifetime()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(SimpleSignature.OtpCheck.Ok, SimpleSignature.Check(Sig("042137", now.AddMinutes(10)), "042137", now));
        Assert.Equal(SimpleSignature.OtpCheck.Ok, SimpleSignature.Check(Sig("042137", now.AddMinutes(10)), " 042137 ", now));
    }

    [Fact]
    public void Check_rejects_wrong_expired_malformed_and_exhausted()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(SimpleSignature.OtpCheck.Wrong, SimpleSignature.Check(Sig("111111", now.AddMinutes(5)), "111112", now));
        Assert.Equal(SimpleSignature.OtpCheck.Expired, SimpleSignature.Check(Sig("111111", now.AddSeconds(-1)), "111111", now));
        Assert.Equal(SimpleSignature.OtpCheck.BadFormat, SimpleSignature.Check(Sig("111111", now.AddMinutes(5)), "11111a", now));
        Assert.Equal(SimpleSignature.OtpCheck.BadFormat, SimpleSignature.Check(Sig("111111", now.AddMinutes(5)), null, now));
        Assert.Equal(SimpleSignature.OtpCheck.TooManyAttempts,
            SimpleSignature.Check(Sig("111111", now.AddMinutes(5), attempts: SimpleSignature.MaxAttempts), "111111", now));
        Assert.Equal(SimpleSignature.OtpCheck.NoCode,
            SimpleSignature.Check(new DocumentSignature { DocumentHash = "x" }, "111111", now));
    }

    [Fact]
    public void Lifetime_and_attempt_limits_match_policy()
    {
        Assert.Equal(TimeSpan.FromMinutes(10), SimpleSignature.OtpLifetime);
        Assert.Equal(5, SimpleSignature.MaxAttempts);
        Assert.Contains("5070", SimpleSignature.Disclaimer);
        Assert.Contains("nitelikli (güvenli) elektronik imza değildir", SimpleSignature.Disclaimer);
    }

    [Theory]
    [InlineData("203.0.113.57", "203.0.113.0")]
    [InlineData("203.0.113.57, 10.0.0.1", "203.0.113.0")]
    [InlineData("::ffff:198.51.100.9", "198.51.100.0")]
    [InlineData("2001:db8:abcd:12:34::1", "2001:db8:abcd::")]
    [InlineData("not-an-ip", null)]
    [InlineData(null, null)]
    public void Ip_is_masked(string? raw, string? expected) => Assert.Equal(expected, SimpleSignature.MaskIp(raw));

    private static Document Doc() => new()
    {
        Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
        EmployeeId = Guid.Parse("22222222-2222-2222-2222-222222222222"),
        FileName = "Sözleşme.pdf", StorageKey = "docs/a.pdf", SizeBytes = 1234, ContentType = "application/pdf",
        Type = DocumentType.Contract, UploadedAt = DateTimeOffset.FromUnixTimeMilliseconds(1_790_000_000_000),
    };

    [Fact]
    public void Document_hash_is_stable_and_detects_changes()
    {
        var h = SimpleSignature.DocumentHash(Doc());
        Assert.Equal(64, h.Length);
        Assert.Equal(h, SimpleSignature.DocumentHash(Doc()));
        var renamed = Doc(); renamed.FileName = "Sözleşme-v2.pdf";
        var moved = Doc(); moved.StorageKey = "docs/b.pdf";
        var resized = Doc(); resized.SizeBytes = 1235;
        Assert.NotEqual(h, SimpleSignature.DocumentHash(renamed));
        Assert.NotEqual(h, SimpleSignature.DocumentHash(moved));
        Assert.NotEqual(h, SimpleSignature.DocumentHash(resized));
        // Postgres mikro saniye hassasiyeti ozeti bozmaz (ms'ye yuvarlanir).
        var micro = Doc(); micro.UploadedAt = micro.UploadedAt.AddTicks(7);
        Assert.Equal(h, SimpleSignature.DocumentHash(micro));
    }

    [Fact]
    public void Evidence_hash_covers_all_fields()
    {
        var e = new SignatureEvidence
        {
            TenantSlug = "demo", SignatureId = Guid.NewGuid(), DocumentId = Guid.NewGuid(), SignerEmployeeId = Guid.NewGuid(),
            SignedAt = DateTimeOffset.UtcNow, DocumentHash = new string('b', 64), IpMasked = "203.0.113.0",
            UserAgentHash = SimpleSignature.HashUserAgent("Mozilla/5.0"), OtpChannel = "InApp+Email", EvidenceHash = "",
        };
        var h = SimpleSignature.EvidenceHash(e);
        e.EvidenceHash = h;
        Assert.Equal(h, SimpleSignature.EvidenceHash(e));
        e.IpMasked = "203.0.114.0";
        Assert.NotEqual(h, SimpleSignature.EvidenceHash(e));
        Assert.Null(SimpleSignature.HashUserAgent("  "));
        Assert.Equal(64, SimpleSignature.HashUserAgent("Mozilla/5.0")!.Length);
    }
}
