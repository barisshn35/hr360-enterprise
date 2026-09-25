using System.Net.Http.Headers;
using System.Text.Json;

namespace TimeShiftService.Services;

/// <summary>
/// employee-service'e cross-service HTTP cagrilari yapar. Kimlik dogrulama
/// cagirani yapan kullanicinin JWT'si AKTARILARAK (pass-through) yapilir -
/// tenant-service'teki EmployeeDirectoryClient ile ayni desen.
/// </summary>
public class EmployeeDirectoryClient
{
    private readonly HttpClient _http;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly string _baseUrl;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public EmployeeDirectoryClient(HttpClient http, IHttpContextAccessor httpContextAccessor)
    {
        _http = http;
        _httpContextAccessor = httpContextAccessor;
        _baseUrl = (Environment.GetEnvironmentVariable("EMPLOYEE_SERVICE_URL")
            ?? "http://172.33.55.2:5002").TrimEnd('/');
    }

    private HttpRequestMessage Build(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, $"{_baseUrl}{path}");
        var incomingAuth = _httpContextAccessor.HttpContext?.Request.Headers.Authorization.ToString();
        if (!string.IsNullOrEmpty(incomingAuth))
            req.Headers.TryAddWithoutValidation("Authorization", incomingAuth);
        return req;
    }

    private record AssignmentDto(Guid DepartmentId, DateOnly EffectiveFrom, DateOnly? EffectiveTo);
    private record EmployeeDto(Guid Id, List<AssignmentDto>? Assignments);

    /// <summary>
    /// Calisanin verilen tarihte AKTIF olan departmanini doner - yoksa null
    /// (calisan atanmamis ya da bulunamadi).
    /// </summary>
    public async Task<Guid?> GetActiveDepartmentAsync(Guid employeeId, DateOnly asOf, CancellationToken ct)
    {
        var resp = await _http.SendAsync(Build(HttpMethod.Get, $"/api/employees/{employeeId}"), ct);
        if (!resp.IsSuccessStatusCode) return null;

        var json = await resp.Content.ReadAsStringAsync(ct);
        var employee = JsonSerializer.Deserialize<EmployeeDto>(json, JsonOpts);
        if (employee?.Assignments is null) return null;

        var active = employee.Assignments.FirstOrDefault(a =>
            a.EffectiveFrom <= asOf && (a.EffectiveTo is null || a.EffectiveTo >= asOf));
        return active?.DepartmentId;
    }
}
