using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using GovernanceService.Infrastructure;
using GovernanceService.Infrastructure.Chat;

namespace GovernanceService.Controllers;

/// <summary>
/// G5: İK'nın ayrılma riski modelini (sentetik veriyle) yeniden eğitmesi governance üzerinden
/// yapılır; ml-inference'ın döndürdüğü özet denetim kaydına yazılır (kim, ne zaman, hangi sürüm,
/// yayımlandı mı). Kiracı verisiyle eğitim yalnızca platform düzeyindedir (ml-inference denetler).
/// </summary>
[Route("api/model")]
[Authorize(Policy = "RequireHrAdmin")]
public class ModelGovernanceController : AppController
{
    private readonly IHttpClientFactory _http;
    private static readonly string MlBase = EnvVar.Or("ML_INFERENCE_URL", "http://ml-inference:8000").TrimEnd('/');
    public ModelGovernanceController(IHttpClientFactory http) => _http = http;

    public record RetrainInput(bool? DryRun);

    [HttpPost("retrain")]
    public async Task<IActionResult> Retrain(RetrainInput body, CancellationToken ct)
    {
        var client = _http.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(5);
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{MlBase}/model/retrain")
        {
            Content = JsonContent.Create(new { source = "synthetic", dry_run = body.DryRun ?? false }),
        };
        req.Headers.TryAddWithoutValidation("Authorization", Request.Headers.Authorization.ToString());
        using var resp = await client.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            return StatusCode((int)resp.StatusCode is 401 or 403 ? 403 : 502, new { message = L("Model yeniden eğitilemedi.", "The model could not be retrained.") });
        using var doc = JsonDocument.Parse(text);
        var hasAudit = doc.RootElement.TryGetProperty("audit", out var a);
        var changes = hasAudit && a.TryGetProperty("changes", out var c) ? c.GetRawText() : "{}";
        var action = hasAudit && a.TryGetProperty("action", out var ac) ? ac.GetString() ?? "Retrained" : "Retrained";
        var entityId = hasAudit && a.TryGetProperty("entityId", out var ei) ? ei.GetString() : null;
        await Db.ExecuteAsync("""
            INSERT INTO audit_log ("TenantSlug","Service","EntityType","EntityId","Action","Changes","UserId","UserName","OccurredAt")
            VALUES ($1,'governance-service','AttritionModel',$2,$3,$4::jsonb,$5,$6,now())
            """, ct, Tenant, entityId, action, changes, Me.UserId, Me.Name);
        return Content(text, "application/json");
    }
}
