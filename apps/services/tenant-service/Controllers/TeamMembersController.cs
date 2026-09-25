using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TenantService.Data;
using TenantService.Services;

namespace TenantService.Controllers;

/// <summary>
/// Tenant icindeki kullanicilarin rol yonetimi: listeleme, davet etme
/// (Keycloak hesabi olusturma), rol atama/kaldirma.
///
/// GUVENLIK:
///   - Cross-tenant koruma: employee-service zaten JWT'deki organization
///     claim'ine gore kendi tenant filtresini uyguluyor - EmployeeDirectoryClient
///     bu JWT'yi ILETIYOR, yani buradan cekilen liste otomatik olarak
///     SADECE cagiranin kendi tenant'ina ait. Ekstra kontrole gerek yok.
///   - Atanabilir roller: SADECE employee/manager/hr-admin/tenant-admin.
///     system-admin ve platform-admin PLATFORM seviyesinde, bu uctan
///     ASLA atanamaz/kaldirilamaz (Keycloak admin konsolundan elle yapilir).
///   - Son yonetici kilidi: bir tenant'taki SON tenant-admin'in rolu
///     kaldirilamaz - tenant yoneticisiz kalmasin.
/// </summary>
[ApiController]
[Route("api/my-tenant/members")]
[Authorize]
public class TeamMembersController : ControllerBase
{
    private static readonly HashSet<string> AssignableRoles =
        new() { "employee", "manager", "accounting", "hr-admin", "tenant-admin" };

    /// <summary>
    /// roles.ts'teki Permission union'iyla BIREBIR ayni olmali - orasi
    /// frontend'in hangi izinleri "var" sayacagini, burasi hangilerinin
    /// bu uctan gecerli sayilacagini belirliyor. Ikisi ayrisirsa,
    /// kullanici arayuzde gormedigi bir izni (gecerli oldugu icin)
    /// atayabilir ya da tam tersi bir izni gecerli sanip deneyip
    /// BadRequest alir.
    /// </summary>
    private static readonly HashSet<string> ExtraAssignablePermissions = new()
    {
        "organization:view", "organization:manage",
        "employee:viewAll", "employee:manage", "employee:create",
        "workflow:view", "workflow:create", "workflow:decide",
        "leave:view", "leave:create", "leave:manageBalance",
        "recruitment:view", "recruitment:candidates", "recruitment:publish",
        "onboarding:view", "onboarding:manage", "asset:manage",
        "timeshift:view", "timeshift:clock", "timeshift:manage",
        "performance:view", "performance:manage",
        "team:manage",
        "learning:view", "learning:enroll", "learning:manage",
        "compensation:view",
        "expense:view", "expense:create", "expense:manage", "expense:markPaid",
        "document:manage",
        "case:view", "case:create", "case:manage",
        "notification:view", "notification:manage",
        "platform:manage",
        "tenant:manage",
    };

    private readonly TenantDbContext _db;
    private readonly EmployeeDirectoryClient _employees;
    private readonly KeycloakAdminClient _keycloak;

    public TeamMembersController(
        TenantDbContext db, EmployeeDirectoryClient employees, KeycloakAdminClient keycloak)
    {
        _db = db;
        _employees = employees;
        _keycloak = keycloak;
    }

    /// <summary>Tenant'taki tum calisanlar + varsa Keycloak rolleri.</summary>
    [HttpGet]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> GetAll(CancellationToken ct)
    {
        var employees = await _employees.GetAllAsync(ct);

        var result = new List<object>();
        foreach (var e in employees)
        {
            List<string> roles = new();
            if (!string.IsNullOrEmpty(e.KeycloakUserId))
                roles = await _keycloak.GetUserRealmRolesAsync(e.KeycloakUserId, ct);

            result.Add(new
            {
                employeeId = e.Id,
                keycloakUserId = e.KeycloakUserId,
                firstName = e.FirstName,
                lastName = e.LastName,
                email = e.Email,
                hasLoginAccess = !string.IsNullOrEmpty(e.KeycloakUserId),
                roles = roles.Where(r => AssignableRoles.Contains(r)),
                // "ext-compensation-view" -> "compensation:view". Sadece
                // ExtraAssignablePermissions'ta hala gecerli olanlari
                // gosteriyoruz - roles.ts'ten kaldirilmis eski bir izin
                // Keycloak'ta rol olarak kalmis olsa bile arayuzde
                // tanimasiz bir sey gorunmemeli.
                extraPermissions = roles
                    .Where(r => r.StartsWith("ext-"))
                    .Select(r => r["ext-".Length..].Replace('-', ':'))
                    .Where(p => ExtraAssignablePermissions.Contains(p)),
            });
        }

        return Ok(result);
    }

    /// <summary>
    /// Calisana giris erisimi verir: Keycloak'ta kullanici yoksa olusturur,
    /// tenant organizasyonuna ekler, employee-service'teki kaydi Keycloak
    /// user ID'siyle iliskilendirir, parola belirleme e-postasi gonderir.
    /// Zaten hesabi varsa (baska bir yoldan olusturulmus) sadece iliskiyi kurar.
    /// </summary>
    [HttpPost("{employeeId:guid}/invite")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Invite(Guid employeeId, CancellationToken ct)
    {
        var slug = User.FindFirst("organization")?.Value?.Trim('[', ']', '"', ' ');
        if (string.IsNullOrWhiteSpace(slug))
            return NotFound(new { message = "Kullanıcı bir şirkete bağlı değil" });

        var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == slug);
        if (tenant is null || tenant.KeycloakOrgId is null)
            return NotFound(new { message = "Tenant kaydı veya Keycloak organizasyonu bulunamadı" });

        var employee = await _employees.GetByIdAsync(employeeId, ct);
        if (employee is null)
            return NotFound(new { message = "Çalışan bulunamadı" });

        if (!string.IsNullOrEmpty(employee.KeycloakUserId))
            return Ok(new { message = "Bu çalışanın zaten giriş erişimi var", keycloakUserId = employee.KeycloakUserId });

        var existingUserId = await _keycloak.FindUserByEmailAsync(employee.Email, ct);
        string userId;
        if (existingUserId is not null)
        {
            userId = existingUserId;
        }
        else
        {
            userId = await _keycloak.CreateUserAsync(
                employee.Email, employee.FirstName, employee.LastName, tenant.Id, ct);
        }

        await _keycloak.AddOrganizationMemberAsync(tenant.KeycloakOrgId, userId, ct);
        await _keycloak.AssignRealmRoleAsync(userId, "employee", ct);
        await _employees.LinkKeycloakUserAsync(employeeId, userId, ct);

        try
        {
            await _keycloak.SendPasswordSetupEmailAsync(userId, ct);
        }
        catch (Exception)
        {
            // Kayit gecerli kalir - SMTP yapilandirilmamis olabilir,
            // yonetici parolayi Keycloak konsolundan elle sifirlayabilir.
        }

        return Ok(new { message = "Davet gönderildi", keycloakUserId = userId });
    }

    public record RoleActionRequest(string KeycloakUserId, string Role);

    [HttpPost("roles")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> AssignRole([FromBody] RoleActionRequest request, CancellationToken ct)
    {
        if (!AssignableRoles.Contains(request.Role))
            return BadRequest(new { message = $"'{request.Role}' bu uctan atanamaz" });

        // Yetki yukseltme koruması: "tenant-admin" rolunu SADECE bir
        // tenant-admin verebilir - hr-admin kendinden daha yuksek bir
        // rolu baskasina VEREMEZ.
        if (request.Role == "tenant-admin" && !User.IsInRole("tenant-admin") && !User.IsInRole("platform-admin"))
            return Forbid();

        await _keycloak.AssignRealmRoleAsync(request.KeycloakUserId, request.Role, ct);
        return Ok(new { message = "Rol atandı" });
    }

    [HttpDelete("roles")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> RemoveRole([FromBody] RoleActionRequest request, CancellationToken ct)
    {
        if (!AssignableRoles.Contains(request.Role))
            return BadRequest(new { message = $"'{request.Role}' bu uctan kaldırılamaz" });

        if (request.Role == "tenant-admin")
        {
            if (!User.IsInRole("tenant-admin") && !User.IsInRole("platform-admin"))
                return Forbid();

            var adminCount = await CountTenantAdminsAsync(ct);
            if (adminCount <= 1)
                return Conflict(new
                {
                    message = "Bu, tenant'taki son şirket yöneticisi. Rol kaldırılamaz - " +
                              "önce başka birine şirket yöneticisi rolü verin.",
                });
        }

        await _keycloak.RemoveRealmRoleAsync(request.KeycloakUserId, request.Role, ct);
        return Ok(new { message = "Rol kaldırıldı" });
    }

    public record PermissionActionRequest(string KeycloakUserId, string Permission);

    /// <summary>
    /// Tek bir izni (roles.ts'teki Permission kodlarindan biri, orn.
    /// "compensation:view"), kullanicinin rolunden BAGIMSIZ olarak dogrudan
    /// atar - "employee" rolundeki biri, hr-admin'in TUM 9 iznini degil,
    /// SADECE "compensation:view"i alabilir.
    ///
    /// GUVENLIK: standart rol atamadan (RequireHrAdmin) daha kisitli -
    /// SADECE tenant-admin/platform-admin cagirabilir. Bu, bilincli bir
    /// tasarim karari: "serbest, rolun disinda tek tek izin verme" gucu,
    /// yalnizca en ust iki role ait olmali - hr-admin standart 5 rolu
    /// atayabilir ama bu ek/serbest mekanizmayi kullanamaz.
    ///
    /// Not: Bu ucun izin verdigi Keycloak rolu (ext-&lt;permission&gt;)
    /// sadece TENANT-SERVICE tarafinda gecerlilik kontrolunden geciyor;
    /// hangi backend servisinin bu ek rolu GERCEKTEN tanidigi (yetkilendirme
    /// policy'sine dahil ettigi) ayrica o serviste yapilmis olmali - bu
    /// ilk surumde sadece compensation-service (compensation:view)
    /// destekliyor, digerleri roles.ts standart rol matrisine gore
    /// calismaya devam ediyor.
    /// </summary>
    [HttpPost("permissions")]
    [Authorize(Policy = "RequireTenantAdminOnly")]
    public async Task<IActionResult> AssignExtraPermission(
        [FromBody] PermissionActionRequest request, CancellationToken ct)
    {
        if (!ExtraAssignablePermissions.Contains(request.Permission))
            return BadRequest(new { message = $"'{request.Permission}' geçerli bir izin değil" });

        // GUVENLIK/yetki yukseltme korumasi: "platform:manage" en ust
        // seviye izin - RequireTenantAdminOnly bir tenant-admin'in de
        // gecmesine izin veriyor, ama bir tenant-admin, PLATFORM-admin
        // OLMAYAN biri olarak, baskasina platform:manage veremez. AssignRole'
        // daki "tenant-admin rolunu sadece tenant-admin verebilir" korumasiyla
        // ayni mantik - burada bir ust seviye: platform:manage'i sadece
        // GERCEK platform-admin verebilir.
        if (request.Permission == "platform:manage" && !User.IsInRole("platform-admin"))
            return Forbid();

        var roleName = $"ext-{request.Permission.Replace(':', '-')}";
        await _keycloak.EnsureRealmRoleExistsAsync(roleName, ct);
        await _keycloak.AssignRealmRoleAsync(request.KeycloakUserId, roleName, ct);
        return Ok(new { message = "İzin atandı" });
    }

    [HttpDelete("permissions")]
    [Authorize(Policy = "RequireTenantAdminOnly")]
    public async Task<IActionResult> RemoveExtraPermission(
        [FromBody] PermissionActionRequest request, CancellationToken ct)
    {
        if (!ExtraAssignablePermissions.Contains(request.Permission))
            return BadRequest(new { message = $"'{request.Permission}' geçerli bir izin değil" });

        var roleName = $"ext-{request.Permission.Replace(':', '-')}";
        await _keycloak.RemoveRealmRoleAsync(request.KeycloakUserId, roleName, ct);
        return Ok(new { message = "İzin kaldırıldı" });
    }

    /// <summary>
    /// KRITIK: N+1 sorgu - her calisan icin Keycloak'a ayri istek atar.
    /// Tenant'lar genelde kucuk oldugu ve bu SIK cagrilan bir uc olmadigi
    /// icin (sadece rol kaldirma oncesi guvenlik kontrolu) kabul edilebilir.
    /// Cok buyuk tenant'larda (yuzlerce kullanici) performans sorunu
    /// yaratirsa, Keycloak'in "get role members" ucuna gecilebilir.
    /// </summary>
    private async Task<int> CountTenantAdminsAsync(CancellationToken ct)
    {
        var employees = await _employees.GetAllAsync(ct);
        var count = 0;
        foreach (var e in employees)
        {
            if (string.IsNullOrEmpty(e.KeycloakUserId)) continue;
            var roles = await _keycloak.GetUserRealmRolesAsync(e.KeycloakUserId, ct);
            if (roles.Contains("tenant-admin")) count++;
        }
        return count;
    }
}
