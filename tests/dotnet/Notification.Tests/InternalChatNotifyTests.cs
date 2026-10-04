using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NotificationService.Controllers;
using NotificationService.Data;
using NotificationService.Models;
using NotificationService.Tenancy;
using Xunit;

namespace Notification.Tests;

/// <summary>Sohbet botunun uygulama içi bildirimi (POST /api/internal/chat/notify).</summary>
public class InternalChatNotifyTests
{
    const string Token = "unit-test-internal-token";
    static readonly Guid Recipient = Guid.NewGuid();

    public InternalChatNotifyTests() => Environment.SetEnvironmentVariable("INTERNAL_SERVICE_TOKEN", Token);

    static (InternalChatController C, NotificationDbContext Db, TenantContext Tenant) Make(string? headerToken = Token)
    {
        var tenant = new TenantContext();
        var db = new NotificationDbContext(new DbContextOptionsBuilder<NotificationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, tenant);
        var ctx = new DefaultHttpContext();
        if (headerToken is not null) ctx.Request.Headers["X-Internal-Token"] = headerToken;
        return (new InternalChatController(db) { ControllerContext = new ControllerContext { HttpContext = ctx } }, db, tenant);
    }

    static InternalChatNotifyRequest Req(string tenant = "acme", string? subject = "Ali size takdir gönderdi: Teşekkürler",
        string? body = "Harika iş!", string? code = "engagement.kudos", string? lang = null) =>
        new(tenant, Recipient, subject, body, code, lang);

    [Theory]
    [InlineData(null)]
    [InlineData("nope")]
    public async Task Rejects_missing_or_wrong_token_with_404(string? header)
    {
        var (c, db, t) = Make(header);
        Assert.IsType<NotFoundResult>(await c.Notify(Req(), t, default));
        Assert.Equal(0, await db.Notifications.IgnoreQueryFilters().CountAsync());
    }

    [Fact]
    public async Task Creates_pending_in_app_message_for_tenant()
    {
        var (c, db, t) = Make();
        var r = Assert.IsType<OkObjectResult>(await c.Notify(Req(), t, default));
        Assert.NotNull(r.Value);
        var n = await db.Notifications.IgnoreQueryFilters().SingleAsync();
        Assert.Equal("acme", n.TenantSlug);
        Assert.Equal(Recipient, n.RecipientEmployeeId);
        Assert.Equal(NotificationChannel.InApp, n.Channel);
        Assert.Equal(NotificationStatus.Pending, n.Status);
        Assert.Equal("engagement.kudos", n.TemplateCode);
        Assert.Equal("Harika iş!", n.Body);
        Assert.Equal("tr", n.Language); // bot metinleri Türkçe
        Assert.Null(n.RecipientEmail);
        Assert.Equal(0, n.AttemptCount);
    }

    [Fact]
    public async Task English_language_is_kept_when_given()
    {
        var (c, db, t) = Make();
        Assert.IsType<OkObjectResult>(await c.Notify(Req(lang: "en"), t, default));
        Assert.Equal("en", (await db.Notifications.IgnoreQueryFilters().SingleAsync()).Language);
    }

    [Fact]
    public async Task Invalid_input_is_400_with_turkish_message_and_nothing_written()
    {
        var (c, db, t) = Make();
        foreach (var bad in new[]
                 {
                     Req(tenant: ""), Req(body: " "), Req(body: new string('x', InternalChatController.MaxBody + 1)),
                     Req(subject: new string('x', InternalChatController.MaxSubject + 1)), Req(code: "Bad Code!"), Req(lang: "de"),
                     Req() with { RecipientEmployeeId = Guid.Empty },
                 })
        {
            var r = Assert.IsType<BadRequestObjectResult>(await c.Notify(bad, t, default));
            var msg = r.Value!.GetType().GetProperty("message")!.GetValue(r.Value) as string;
            Assert.False(string.IsNullOrWhiteSpace(msg));
        }
        Assert.Equal(0, await db.Notifications.IgnoreQueryFilters().CountAsync());
    }

    [Theory]
    [InlineData("engagement.kudos")]
    [InlineData("shift.swap.approval")]
    [InlineData("shift.swap.decision")]
    [InlineData(null)]
    public void Bot_template_codes_are_accepted(string? code) =>
        Assert.Null(InternalChatController.Validate(Req(code: code)));
}
