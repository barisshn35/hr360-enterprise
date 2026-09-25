using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TenantService.Services;

/// <summary>
/// employee-service'e cross-service HTTP cagrilari yapar. Kimlik dogrulama
/// SERVICE-TO-SERVICE ozel bir token ILE DEGIL, cagirani yapan kullanicinin
/// KENDI JWT'si employee-service'e AKTARILARAK yapilir (pass-through) -
/// boylece employee-service kendi RequireHrAdmin/RequireTenantAdmin
/// policy'lerini normal sekilde uygular, iki servis arasinda AYRI bir
/// guven iliskisi kurmaya gerek kalmaz.
/// </summary>
public class EmployeeDirectoryClient
{
    private readonly HttpClient _http;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly string _baseUrl;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public EmployeeDirectoryClient(HttpClient http, IHttpContextAccessor httpContextAccessor)
    {
        _http = http;
        _httpContextAccessor = httpContextAccessor;
        _baseUrl = (Environment.GetEnvironmentVariable("EMPLOYEE_SERVICE_URL")
            ?? "http://172.33.55.2:5002").TrimEnd('/');
    }

    private HttpRequestMessage Build(HttpMethod method, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, $"{_baseUrl}{path}");

        var incomingAuth = _httpContextAccessor.HttpContext?.Request.Headers.Authorization.ToString();
        if (!string.IsNullOrEmpty(incomingAuth))
            req.Headers.TryAddWithoutValidation("Authorization", incomingAuth);

        if (body is not null)
            req.Content = new StringContent(JsonSerializer.Serialize(body, JsonOpts), Encoding.UTF8, "application/json");

        return req;
    }

    public record EmployeeSummary(Guid Id, string FirstName, string LastName, string Email, string? KeycloakUserId);

    public async Task<List<EmployeeSummary>> GetAllAsync(CancellationToken ct)
    {
        var resp = await _http.SendAsync(Build(HttpMethod.Get, "/api/employees"), ct);
        if (!resp.IsSuccessStatusCode) return new List<EmployeeSummary>();

        var json = await resp.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<List<EmployeeSummary>>(json, JsonOpts) ?? new List<EmployeeSummary>();
    }

    public async Task<EmployeeSummary?> GetByIdAsync(Guid employeeId, CancellationToken ct)
    {
        var resp = await _http.SendAsync(Build(HttpMethod.Get, $"/api/employees/{employeeId}"), ct);
        if (!resp.IsSuccessStatusCode) return null;

        var json = await resp.Content.ReadAsStringAsync(ct);
        return JsonSerializer.Deserialize<EmployeeSummary>(json, JsonOpts);
    }

    public async Task LinkKeycloakUserAsync(Guid employeeId, string keycloakUserId, CancellationToken ct)
    {
        var resp = await _http.SendAsync(
            Build(HttpMethod.Put, $"/api/employees/{employeeId}/keycloak-link", new { keycloakUserId }), ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Calisan-Keycloak baglantisi kurulamadi ({(int)resp.StatusCode}): {err}");
        }
    }
}
