using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace TenantService.Services;

/// <summary>
/// Keycloak Admin REST API sarmalayicisi. Organization olusturma, kullanici
/// saglama ve rol atama islerini yapar.
///
/// Kimlik dogrulama: master realm'de admin-cli client'i uzerinden
/// service account. Parola ortam degiskeninden okunur.
/// </summary>
public class KeycloakAdminClient
{
    private readonly HttpClient _http;
    private readonly ILogger<KeycloakAdminClient> _logger;
    private readonly string _baseUrl;
    private readonly string _realm;
    private readonly string _adminUser;
    private readonly string _adminPassword;

    private string? _token;
    private DateTimeOffset _tokenExpiresAt = DateTimeOffset.MinValue;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public KeycloakAdminClient(HttpClient http, ILogger<KeycloakAdminClient> logger)
    {
        _http = http;
        _logger = logger;
        _baseUrl = (Environment.GetEnvironmentVariable("KEYCLOAK_BASE_URL")
            ?? "http://172.33.55.2:8080").TrimEnd('/');
        _realm = Environment.GetEnvironmentVariable("KEYCLOAK_REALM") ?? "hr360";
        _adminUser = Environment.GetEnvironmentVariable("KEYCLOAK_ADMIN_USER")
            ?? throw new InvalidOperationException("KEYCLOAK_ADMIN_USER tanımlı olmalı");
        _adminPassword = Environment.GetEnvironmentVariable("KEYCLOAK_ADMIN_PASSWORD")
            ?? throw new InvalidOperationException("KEYCLOAK_ADMIN_PASSWORD tanımlı olmalı");
    }

    // ------------------------------------------------------------ token

    private async Task<string> GetTokenAsync(CancellationToken ct)
    {
        if (_token is not null && DateTimeOffset.UtcNow < _tokenExpiresAt)
            return _token;

        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "password",
            ["client_id"] = "admin-cli",
            ["username"] = _adminUser,
            ["password"] = _adminPassword,
        });

        var resp = await _http.PostAsync(
            $"{_baseUrl}/realms/master/protocol/openid-connect/token", form, ct);
        resp.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        _token = doc.RootElement.GetProperty("access_token").GetString()!;
        var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var e) ? e.GetInt32() : 60;
        // Erken yenile: sinira dayanmadan 10 saniye once gecersiz say.
        _tokenExpiresAt = DateTimeOffset.UtcNow.AddSeconds(Math.Max(10, expiresIn - 10));
        return _token;
    }

    private async Task<HttpRequestMessage> BuildAsync(
        HttpMethod method, string path, object? body, CancellationToken ct)
    {
        var req = new HttpRequestMessage(method, $"{_baseUrl}/admin/realms/{_realm}{path}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetTokenAsync(ct));
        if (body is not null)
        {
            req.Content = new StringContent(
                JsonSerializer.Serialize(body, JsonOpts), Encoding.UTF8, "application/json");
        }
        return req;
    }

    /// <summary>Location header'indan olusturulan kaynagin kimligini cikarir.</summary>
    private static string? IdFromLocation(HttpResponseMessage resp)
        => resp.Headers.Location?.Segments.LastOrDefault()?.Trim('/');

    // ---------------------------------------------------- organizations

    public async Task<string> CreateOrganizationAsync(
        string name, string alias, string? emailDomain, CancellationToken ct)
    {
        var domains = string.IsNullOrWhiteSpace(emailDomain)
            ? new[] { new { name = $"{alias}.hr360.local" } }
            : new[] { new { name = emailDomain } };

        // NOT: Keycloak'in (bu projede kullanilan surum: 25.0) Organizations Admin
        // REST API'sinde "alias" DIYE BIR ALAN YOK - OrganizationRepresentation'in
        // bildigi tek alanlar: enabled, identityProviders, attributes, members, id,
        // description, domains, name. Eskiden burada gonderilen "alias" alani sunucu
        // tarafindan sessizce degil, ACIKCA 400 Bad Request ile reddediliyordu -
        // yani sirket kayit sihirbazinin TUMU (ProvisionAsync -> bu metod) HER
        // ZAMAN patliyordu ve telafi/rollback mantigi devreye girip olusturulan
        // tenant kaydini geri aliyordu (hardcore test sirasinda bulundu - demo
        // tenant seed'i denerken ayni hatayla karsilasildi).
        //
        // Keycloak, oturum acan kullanicinin JWT'sindeki "organization" claim'ini
        // organizasyonun "name" alaniyla anahtarliyor (alias/slug DEGIL - Keycloak'ta
        // boyle bir kavram yok). MyTenantController ise bu claim'i tenant'in Slug'iyla
        // eslestiriyor. Bu yuzden Keycloak organizasyonunun "name" alanina insan-okur
        // gorunen adi degil, SLUG'i ("alias" parametresi) yaziyoruz; insan-okur adi
        // "description" alaninda saklaniyor.
        var req = await BuildAsync(HttpMethod.Post, "/organizations",
            new { name = alias, description = name, enabled = true, domains }, ct);

        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Keycloak organizasyon oluşturulamadı ({(int)resp.StatusCode}): {err}");
        }

        var id = IdFromLocation(resp)
            ?? throw new InvalidOperationException("Organizasyon kimligi Location header'inda yok");
        _logger.LogInformation("Keycloak organizasyonu oluşturuldu: {Alias} ({Id})", alias, id);
        return id;
    }

    public async Task DeleteOrganizationAsync(string orgId, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Delete, $"/organizations/{orgId}", null, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            _logger.LogWarning("Organizasyon silinemedi {Id}: {Status}", orgId, resp.StatusCode);
    }

    public async Task AddOrganizationMemberAsync(string orgId, string userId, CancellationToken ct)
    {
        var req = new HttpRequestMessage(
            HttpMethod.Post, $"{_baseUrl}/admin/realms/{_realm}/organizations/{orgId}/members");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetTokenAsync(ct));
        // NOT: Bu uc gecerli bir JSON string (tirnak icinde, orn. "\"<id>\"") GONDERILDIGINDE
        // Keycloak 25.0.6'da HER ZAMAN "User does not exist" (400) doner - kullanici
        // gercekten var ve id dogru olsa bile (canli sunucuya karsi curl/http.client ile
        // dogrulandi: tirnaksiz DUZ METIN govde 201 donuyor, ayni govde JSON-tirnakli
        // haliyle 400 donuyor). Bu, Keycloak'in bu uctaki govdeyi JSON olarak degil DUZ
        // METIN olarak parse etmesinden kaynaklaniyor; @Content-Type application/json
        // yine de gerekli (text/plain 415 donuyor). Sirket kayit sihirbazinin (ve demo
        // tenant seed'inin) HER ZAMAN "Kullanıcı organizasyona eklenemedi (400): User
        // does not exist" ile patlamasina sebep olan asil kok neden buydu - hardcore
        // test sirasinda bulundu ve canli Keycloak'a karsi curl ile dogrulandi.
        req.Content = new StringContent(userId, Encoding.UTF8, "application/json");

        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Kullanıcı organizasyona eklenemedi ({(int)resp.StatusCode}): {err}");
        }
    }

    // ----------------------------------------------------------- users

    /// <summary>
    /// Kullanici bu Keycloak organizasyonunun uyesi mi? (200 = uye, 404 = degil).
    /// Rol/izin degisikliklerinden once hedefin CAGIRANIN kiracisina ait
    /// oldugunu dogrulamak icin kullanilir - realm rolleri tum kiracilarda
    /// ortak oldugundan bu kontrol olmadan bir kiracinin yoneticisi baska
    /// bir kiracinin kullanicisina rol verebiliyordu.
    /// </summary>
    public async Task<bool> IsOrganizationMemberAsync(string orgId, string userId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(orgId) || string.IsNullOrWhiteSpace(userId)) return false;
        var req = new HttpRequestMessage(HttpMethod.Get,
            $"{_baseUrl}/admin/realms/{_realm}/organizations/{Uri.EscapeDataString(orgId)}/members/{Uri.EscapeDataString(userId)}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetTokenAsync(ct));
        using var resp = await _http.SendAsync(req, ct);
        if (resp.StatusCode == System.Net.HttpStatusCode.NotFound) return false;
        if (!resp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Organizasyon uyeligi dogrulanamadi ({(int)resp.StatusCode})");
        return true;
    }

    public async Task<string?> FindUserByEmailAsync(string email, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Get,
            $"/users?email={Uri.EscapeDataString(email)}&exact=true", null, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode) return null;

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        return doc.RootElement.GetArrayLength() > 0
            ? doc.RootElement[0].GetProperty("id").GetString()
            : null;
    }

    /// <summary>
    /// Parolasiz kullanici olusturur. Kullanici, UPDATE_PASSWORD required action'i
    /// ile ilk giriste parolasini kendisi belirler - parola hicbir yerde uretilmez
    /// veya saklanmaz.
    /// </summary>
    public async Task<string> CreateUserAsync(
        string email, string? firstName, string? lastName, Guid tenantId, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Post, "/users", new
        {
            username = email,
            email,
            firstName = firstName ?? "",
            lastName = lastName ?? "",
            enabled = true,
            emailVerified = false,
            requiredActions = new[] { "UPDATE_PASSWORD" },
            // Tenant kimligini kullanici ozniteligi olarak da tut: organization
            // claim'i alias tasir, servislerin GUID'e ihtiyaci olursa buradan alinir.
            attributes = new Dictionary<string, string[]>
            {
                ["tenant_id"] = new[] { tenantId.ToString() },
            },
        }, ct);

        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Kullanıcı oluşturulamadı ({(int)resp.StatusCode}): {err}");
        }

        return IdFromLocation(resp)
            ?? throw new InvalidOperationException("Kullanıcı kimliği Location header'ında yok");
    }

    public async Task AssignRealmRoleAsync(string userId, string roleName, CancellationToken ct)
    {
        var role = await GetRealmRoleAsync(roleName, ct)
            ?? throw new InvalidOperationException($"Rol bulunamadi: {roleName}");

        var req = await BuildAsync(
            HttpMethod.Post, $"/users/{userId}/role-mappings/realm", new[] { role }, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Rol atanamadi ({(int)resp.StatusCode}): {err}");
        }
    }

    /// <summary>Bir kullanicidan realm rolunu kaldirir. Keycloak DELETE
    /// body'sinin de kaldirilacak rolun {id, name} bilgisini tasimasini
    /// bekler - GET ile ayni sekilde once rolu cozup gonderiyoruz.</summary>
    public async Task RemoveRealmRoleAsync(string userId, string roleName, CancellationToken ct)
    {
        var role = await GetRealmRoleAsync(roleName, ct)
            ?? throw new InvalidOperationException($"Rol bulunamadi: {roleName}");

        var req = new HttpRequestMessage(
            HttpMethod.Delete, $"{_baseUrl}/admin/realms/{_realm}/users/{userId}/role-mappings/realm");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetTokenAsync(ct));
        req.Content = new StringContent(
            JsonSerializer.Serialize(new[] { role }, JsonOpts), Encoding.UTF8, "application/json");

        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Rol kaldirilamadi ({(int)resp.StatusCode}): {err}");
        }
    }

    /// <summary>Bir kullanicinin su an sahip oldugu realm rollerinin adlarini dondurur.</summary>
    public async Task<List<string>> GetUserRealmRolesAsync(string userId, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Get, $"/users/{userId}/role-mappings/realm", null, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode) return new List<string>();

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        return doc.RootElement.EnumerateArray()
            .Select(r => r.GetProperty("name").GetString() ?? "")
            .Where(n => n.Length > 0)
            .ToList();
    }

    private async Task<object?> GetRealmRoleAsync(string roleName, CancellationToken ct)
    {
        var roleReq = await BuildAsync(HttpMethod.Get, $"/roles/{roleName}", null, ct);
        var roleResp = await _http.SendAsync(roleReq, ct);
        if (!roleResp.IsSuccessStatusCode) return null;

        using var doc = JsonDocument.Parse(await roleResp.Content.ReadAsStringAsync(ct));
        return new
        {
            id = doc.RootElement.GetProperty("id").GetString(),
            name = doc.RootElement.GetProperty("name").GetString(),
        };
    }

    /// <summary>
    /// "Ek izin" rolleri (ext-&lt;permission&gt;, orn. ext-compensation-view)
    /// icin - bu roller sabit 5 roldeki (employee/manager/accounting/
    /// hr-admin/tenant-admin) gibi Keycloak'ta onceden elle olusturulmus
    /// degil, ilk atamada kendiliginden yaratilir. Zaten varsa (rol id'si
    /// donerse) hicbir sey yapmaz - iki farkli kullaniciya ayni ek izni
    /// atarken ayni rolu iki kez olusturmaya calismak hataya yol acmamali.
    /// </summary>
    public async Task EnsureRealmRoleExistsAsync(string roleName, CancellationToken ct)
    {
        var existing = await GetRealmRoleAsync(roleName, ct);
        if (existing is not null) return;

        var req = await BuildAsync(HttpMethod.Post, "/roles", new { name = roleName }, ct);
        var resp = await _http.SendAsync(req, ct);
        // 409 Conflict: baska bir istek ayni anda olusturmus olabilir - o
        // da basarili sayilir, rol zaten var demektir.
        if (!resp.IsSuccessStatusCode && resp.StatusCode != System.Net.HttpStatusCode.Conflict)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"'{roleName}' rolu olusturulamadi ({(int)resp.StatusCode}): {err}");
        }
    }

    /// <summary>
    /// Parola belirleme e-postasi gonderir. Keycloak'ta SMTP yapilandirilmis
    /// olmalidir; degilse bu adim basarisiz olur ama kayit gecerli kalir
    /// (yonetici parolayi elle sifirlayabilir).
    /// </summary>
    public async Task SendPasswordSetupEmailAsync(string userId, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Put,
            $"/users/{userId}/execute-actions-email?lifespan=86400",
            new[] { "UPDATE_PASSWORD" }, ct);

        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var err = await resp.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException(
                $"Parola e-postasi gonderilemedi ({(int)resp.StatusCode}): {err}");
        }
    }

    public async Task DeleteUserAsync(string userId, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Delete, $"/users/{userId}", null, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            _logger.LogWarning("Kullanıcı silinemedi {Id}: {Status}", userId, resp.StatusCode);
    }

    public async Task SetUserEnabledAsync(string userId, bool enabled, CancellationToken ct)
    {
        var req = await BuildAsync(HttpMethod.Put, $"/users/{userId}", new { enabled }, ct);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
            _logger.LogWarning("Kullanıcı durumu değiştirilemedi {Id}", userId);
    }
}
