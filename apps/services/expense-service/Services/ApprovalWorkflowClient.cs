using System.Text;
using System.Text.Json;

namespace ExpenseService.Services;

/// <summary>
/// Masraf beyani gonderildiginde otomatik bir onay akisi (WorkflowRequest)
/// baslatir - leave-service'teki ApprovalWorkflowClient ile ayni desen
/// (ayni kok sorun: frontend, beyan gonderirken workflow-service'e hic
/// baglanmiyordu, SubmitClaimRequest.WorkflowRequestId hep null geliyordu).
///
/// Zincir: employee-service'ten calisanin aktif departmanini bul ->
/// organization-service'ten o departmanin basini (HeadEmployeeId) bul ->
/// workflow-service'te bir WorkflowRequest ac. Kimlik dogrulama, cagirani
/// yapan kullanicinin KENDI JWT'si iletilerek yapilir (pass-through).
///
/// Departman basi bulunamazsa (atanmamis ya da calisan kendisi bas ise)
/// onay akisi acilmaz - talep expense-service'te Submitted kalir ve mevcut
/// /resolve ucuyla (RequireManagerOrAbove) elle sonuclandirilabilir.
/// </summary>
public class ApprovalWorkflowClient
{
    private readonly HttpClient _http;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly string _employeeServiceUrl;
    private readonly string _organizationServiceUrl;
    private readonly string _workflowServiceUrl;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public ApprovalWorkflowClient(HttpClient http, IHttpContextAccessor httpContextAccessor)
    {
        _http = http;
        _httpContextAccessor = httpContextAccessor;
        _employeeServiceUrl = (Environment.GetEnvironmentVariable("EMPLOYEE_SERVICE_URL")
            ?? "http://172.33.55.2:5002").TrimEnd('/');
        _organizationServiceUrl = (Environment.GetEnvironmentVariable("ORGANIZATION_SERVICE_URL")
            ?? "http://172.33.55.2:5001").TrimEnd('/');
        _workflowServiceUrl = (Environment.GetEnvironmentVariable("WORKFLOW_SERVICE_URL")
            ?? "http://172.33.55.3:5003").TrimEnd('/');
    }

    private HttpRequestMessage Build(HttpMethod method, string baseUrl, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, $"{baseUrl}{path}");
        var incomingAuth = _httpContextAccessor.HttpContext?.Request.Headers.Authorization.ToString();
        if (!string.IsNullOrEmpty(incomingAuth))
            req.Headers.TryAddWithoutValidation("Authorization", incomingAuth);
        if (body is not null)
            req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return req;
    }

    private record AssignmentDto(Guid DepartmentId, DateOnly? EffectiveTo);
    private record EmployeeDto(Guid Id, List<AssignmentDto> Assignments);
    private record DepartmentDto(Guid Id, string Name, Guid? HeadEmployeeId);
    private record CreateWorkflowBody(
        int Type, Guid RequesterEmployeeId, string? Subject, string? Payload,
        List<Guid> ApproverEmployeeIds, int? SlaHours);
    private record WorkflowCreatedDto(Guid Id);

    /// <summary>
    /// Calisanin aktif departmaninin basini onayci yaparak workflow-service'te
    /// bir "ExpenseClaim" (enum deger 1) turu WorkflowRequest acar ve olusan
    /// Id'yi doner. Zincirin herhangi bir adimi basarisiz olursa null doner.
    /// </summary>
    public async Task<Guid?> StartExpenseApprovalAsync(
        Guid employeeId, string? subject, CancellationToken ct)
    {
        try
        {
            var empResp = await _http.SendAsync(
                Build(HttpMethod.Get, _employeeServiceUrl, $"/api/employees/{employeeId}"), ct);
            if (!empResp.IsSuccessStatusCode) return null;

            var employee = JsonSerializer.Deserialize<EmployeeDto>(
                await empResp.Content.ReadAsStringAsync(ct), JsonOpts);
            var activeDeptId = employee?.Assignments
                .FirstOrDefault(a => a.EffectiveTo is null)?.DepartmentId;
            if (activeDeptId is null) return null;

            var deptResp = await _http.SendAsync(
                Build(HttpMethod.Get, _organizationServiceUrl, $"/api/departments/{activeDeptId}"), ct);
            if (!deptResp.IsSuccessStatusCode) return null;

            var dept = JsonSerializer.Deserialize<DepartmentDto>(
                await deptResp.Content.ReadAsStringAsync(ct), JsonOpts);
            if (dept?.HeadEmployeeId is null || dept.HeadEmployeeId == employeeId) return null;

            var wfResp = await _http.SendAsync(
                Build(HttpMethod.Post, _workflowServiceUrl, "/api/workflows", new CreateWorkflowBody(
                    Type: 1, // WorkflowType.ExpenseClaim
                    RequesterEmployeeId: employeeId,
                    Subject: subject,
                    Payload: null,
                    ApproverEmployeeIds: new List<Guid> { dept.HeadEmployeeId.Value },
                    SlaHours: null)), ct);
            if (!wfResp.IsSuccessStatusCode) return null;

            var created = JsonSerializer.Deserialize<WorkflowCreatedDto>(
                await wfResp.Content.ReadAsStringAsync(ct), JsonOpts);
            return created?.Id;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>
    /// Istegi yapan kullanicinin kendi calisan kaydinin ID'sini bulur -
    /// "kendi actigi beyani kendi sonuclandiramaz" (self-approval engeli)
    /// ve "employee rolu yalnizca kendi kaydini sorgulayabilir" (GetAll
    /// IDOR duzeltmesi) kontrollerinde kullanilir.
    ///
    /// employee-service'teki /api/employees/me ucunu kullanir (JWT'nin
    /// KeycloakUserId'siyle eslesen kaydi doner). Onceki surum JWT email'ini
    /// employee.Email ile eslestiriyordu - ama bir kullanicinin Keycloak
    /// giris e-postasi ile employee kaydindaki e-postasi FARKLI olabiliyor
    /// (orn. sirket kaydi kisisel e-postayla acilmis, Keycloak girisi
    /// kurumsal e-postayla); bu durumda email sorgusu sessizce bos donuyor,
    /// self-approval kontrolu de sessizce atlaniyordu (bugun canli ortamda
    /// dogrulandi). /me, KeycloakUserId uzerinden eslestigi icin bu sorunu
    /// tasimiyor.
    /// </summary>
    public async Task<Guid?> FindMyEmployeeIdAsync(CancellationToken ct)
    {
        try
        {
            var resp = await _http.SendAsync(
                Build(HttpMethod.Get, _employeeServiceUrl, "/api/employees/me"), ct);
            if (!resp.IsSuccessStatusCode) return null;
            var me = JsonSerializer.Deserialize<EmployeeIdDto>(
                await resp.Content.ReadAsStringAsync(ct), JsonOpts);
            return me?.Id;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private record EmployeeIdDto(Guid Id);
}
