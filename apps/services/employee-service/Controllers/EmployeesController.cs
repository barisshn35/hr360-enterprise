using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using EmployeeService.Data;
using EmployeeService.Models;
using EmployeeService.Messaging;
using EmployeeService.Services;
using System.Text.Json;

namespace EmployeeService.Controllers;

[ApiController]
[Route("api/employees")]
[Authorize]
public class EmployeesController : ControllerBase
{
    private readonly EmployeeDbContext _db;
    private readonly OrganizationDirectoryClient _organizations;

    public EmployeesController(EmployeeDbContext db, OrganizationDirectoryClient organizations)
    {
        _db = db;
        _organizations = organizations;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? email)
    {
        // manager+ serbestce sorgular (email'siz = tum liste dahil).
        // "employee" rolu ise SADECE kendi kaydini (JWT'deki email'iyle
        // eslesen) sorgulayabilir - boylece "benim iznim/masrafim" gibi
        // ekranlarda EmployeePicker kendi kaydini cozebilir, ama tum
        // calisan listesine erisemez.
        var isManagerOrAbove = User.IsInRole("manager") || User.IsInRole("hr-admin")
            || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin");

        if (!isManagerOrAbove)
        {
            // MapInboundClaims (varsayılan true) "email" claim'ini .NET'in
            // kendi URI formatına donusturuyor - hem ham hem donusturulmus
            // ismi deniyoruz, servisin claim mapping ayarindan bagimsiz olsun.
            var callerEmail = User.FindFirst("email")?.Value
                ?? User.FindFirst(System.Security.Claims.ClaimTypes.Email)?.Value;
            if (string.IsNullOrEmpty(callerEmail)
                || string.IsNullOrEmpty(email)
                || !string.Equals(email, callerEmail, StringComparison.OrdinalIgnoreCase))
                return Forbid();
        }

        var q = _db.Employees.Include(e => e.Assignments).AsQueryable();

        // E-posta filtresi: token sahibini calisan kaydiyla eslestirmek icin.
        // Olmadiginda cagiran tum listeyi cekip istemcide filtrelemek
        // zorunda kaliyordu - binlerce calisanli kiracida sorun olurdu.
        if (!string.IsNullOrWhiteSpace(email))
            q = q.Where(e => e.Email.ToLower() == email.ToLower());

        return Ok(await q.ToListAsync());
    }

    /// <summary>
    /// Istegi yapan kullanicinin kendi calisan kaydini doner - KeycloakUserId
    /// (JWT'nin sub/nameidentifier claim'i) uzerinden, EMAIL UZERINDEN DEGIL.
    ///
    /// GUVENLIK: GetAll'daki email eslemesi (JWT email == employee.Email)
    /// gecerli bir varsayim degil - bir kullanicinin Keycloak giris e-postasi
    /// (orn. "baris.sahin@teletek.net.tr") ile employee kaydindaki e-postasi
    /// (orn. sirketi kaydederken girilen kisisel "barisshn888@gmail.com")
    /// farkli olabilir; bu durumda GetAll?email=<jwt-email> hicbir sonuc
    /// donmuyordu. workflow/leave/expense-service'teki self-approval
    /// kontrolleri bu ucu kullaniyor (bkz. FindMyEmployeeIdAsync) - email
    /// eslemesi sessizce basarisiz oldugunda kontrolun de sessizce
    /// atlanmasina (guvenlik acigina) yol aciyordu.
    ///
    /// Her rol cagirabilir - bu "kendi kaydim" sorgusu, employee:viewAll
    /// gerektirmez.
    /// </summary>
    [HttpGet("me")]
    public async Task<IActionResult> GetMe()
    {
        var keycloakUserId = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(keycloakUserId)) return NotFound();

        var me = await _db.Employees.FirstOrDefaultAsync(e => e.KeycloakUserId == keycloakUserId);
        return me is null ? NotFound() : Ok(me);
    }

    /// <summary>
    /// Calisan dizini: YALNIZCA kimlik ve ad.
    ///
    /// Her rol cagirabilir. Arayuzde ID yerine isim gosterebilmek icin
    /// gerekli - calisan kendi ekibini gorurken "a6e3903d-88d4..." degil
    /// "Ahmet Yilmaz" gormeli. GetAll yonetici yetkisi istedigi icin
    /// calisan rolu oradan isim cozemiyordu.
    ///
    /// Maas, e-posta, ise giris tarihi gibi HICBIR hassas alan donmez.
    /// Bir sirket icinde calisan adlari zaten paylasilan bilgidir;
    /// gizlemek guvenlik saglamaz, yalnizca arayuzu kullanilmaz kilar.
    /// </summary>
    [HttpGet("directory")]
    public async Task<IActionResult> Directory()
    {
        var list = await _db.Employees
            .OrderBy(e => e.FirstName).ThenBy(e => e.LastName)
            .Select(e => new
            {
                e.Id,
                e.FirstName,
                e.LastName,
                fullName = e.FirstName + " " + e.LastName,
            })
            .ToListAsync();

        return Ok(list);
    }

    /// <summary>
    /// Tam kaydi (atamalar dahil) gorebilenler. Modul yonetim izinleri (ext-*-manage,
    /// orn. ext-timeshift-manage) de dahil: bu kullanicilarin servisleri (vardiya
    /// ekibine uye ekleme gibi) calisanin departman atamasini kendi jetonlariyla okur;
    /// kisitli gorunumde atamalar olmadigi icin gecerli uyeler bile reddediliyordu.
    /// </summary>
    private bool IsManagerOrAbove => User.IsInRole("manager") || User.IsInRole("hr-admin")
        || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin")
        || User.IsInRole("ext-employee-viewAll")
        || User.Claims.Any(c => c.Type == System.Security.Claims.ClaimTypes.Role
            && c.Value.StartsWith("ext-", StringComparison.Ordinal)
            && c.Value.EndsWith("-manage", StringComparison.Ordinal));

    private bool IsHr => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin")
        || User.IsInRole("platform-admin") || User.IsInRole("ext-employee-manage");

    private string? CallerSub => User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
        ?? User.FindFirst("sub")?.Value;

    /// <summary>
    /// GUVENLIK: Onceden herhangi bir calisan, dizinden ogrendigi kimlikle her
    /// meslektasinin TAM kaydini (telefon, ise giris tarihi, KeycloakUserId, atama
    /// gecmisi) okuyabiliyordu (canli dogrulandi). Kaydin sahibi ve yonetici+ tam
    /// kaydi gorur; digerleri yalnizca kurumsal rehber bilgisini (ad, e-posta, durum)
    /// - diger servisler (orn. workflow-service onayciya bildirim icin) kullanicinin
    /// jetonuyla yalnizca bu alanlara ihtiyac duyuyor.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var employee = await _db.Employees.Include(e => e.Assignments).FirstOrDefaultAsync(e => e.Id == id);
        if (employee is null) return NotFound();
        if (IsManagerOrAbove || (CallerSub is { } sub && employee.KeycloakUserId == sub))
            return Ok(employee);
        return Ok(new
        {
            employee.Id, employee.FirstName, employee.LastName, employee.Email, employee.Status,
        });
    }

    /// <summary>
    /// Bu calisanin Keycloak kullanicisiyla baglantisini kurar - tenant-service
    /// "davet et" akisinda (yeni Keycloak kullanicisi olusturduktan sonra)
    /// cagirir. Cross-service call, cagiranin KENDI JWT'si iletilerek
    /// yapilir - o yuzden burada da RequireTenantAdmin/HrAdmin yeterli,
    /// service-to-service ayri bir kimlik dogrulamaya gerek yok.
    /// </summary>
    public record LinkKeycloakUserRequest(string KeycloakUserId);

    [HttpPut("{id}/keycloak-link")]
    [Authorize(Policy = "RequireHrAdmin")]
    public async Task<IActionResult> LinkKeycloakUser(Guid id, [FromBody] LinkKeycloakUserRequest request)
    {
        var employee = await _db.Employees.FirstOrDefaultAsync(e => e.Id == id);
        if (employee is null) return NotFound();

        // GUVENLIK: Ayni giris hesabi birden fazla calisan kaydina baglanabiliyordu -
        // /me (FirstOrDefault) o zaman talep sahibi olarak kullanilandan FARKLI bir
        // kayit dondurup kendi talebini onaylama korumalarini bosa cikarabiliyordu.
        if (string.IsNullOrWhiteSpace(request.KeycloakUserId))
            return BadRequest(new { message = "KeycloakUserId zorunlu" });
        var takenBy = await _db.Employees.IgnoreQueryFilters()
            .Where(e => e.KeycloakUserId == request.KeycloakUserId && e.Id != id)
            .Select(e => (Guid?)e.Id).FirstOrDefaultAsync();
        if (takenBy is not null)
            return Conflict(new { message = "Bu giriş hesabı başka bir çalışan kaydına bağlı" });
        if (!string.IsNullOrEmpty(employee.KeycloakUserId) && employee.KeycloakUserId != request.KeycloakUserId)
            return Conflict(new { message = "Bu çalışan zaten başka bir giriş hesabına bağlı" });

        employee.KeycloakUserId = request.KeycloakUserId;
        await _db.SaveChangesAsync();
        return Ok(new { employeeId = id, keycloakUserId = employee.KeycloakUserId });
    }

    [HttpPost]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> Create([FromBody] CreateEmployeeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FirstName) || string.IsNullOrWhiteSpace(request.LastName))
            return BadRequest(new { message = "Ad ve soyad zorunlu" });
        if (string.IsNullOrWhiteSpace(request.Email)
            || !System.Text.RegularExpressions.Regex.IsMatch(request.Email.Trim(), @"^[^@\s]+@[^@\s]+\.[^@\s]+$"))
            return BadRequest(new { message = "Geçerli bir e-posta adresi girin" });
        var normalizedEmail = request.Email.Trim().ToLowerInvariant();
        // NOT: Ayni kiracida ayni e-posta tekrar eklenemez (onceden veritabani
        // kisitina carpip 500 donuyordu). Kontrol kiraci filtresiyle yapilir; baska
        // bir kiracidaki ayni adres engel degildir (bkz. kiraci bazli benzersiz indeks).
        if (await _db.Employees.AnyAsync(e => e.Email.ToLower() == normalizedEmail))
            return Conflict(new { message = "Bu e-posta ile kayıtlı bir çalışan zaten var" });

        var employee = new Employee
        {
            FirstName = request.FirstName,
            LastName = request.LastName,
            Email = normalizedEmail,
            Phone = request.Phone,
            HireDate = request.HireDate
        };
        _db.Employees.Add(employee);

        // Event, is verisiyle AYNI transaction'da outbox'a yazilir.
        _db.OutboxMessages.Add(new OutboxMessage
        {
            Topic = EmployeeTopics.Events,
            EventType = EmployeeEventTypes.Hired,
            PartitionKey = employee.Id.ToString(),
            Payload = JsonSerializer.Serialize(new EmployeeHiredEvent(
                _db.CurrentTenantSlug ?? "",
                employee.Id, employee.FirstName, employee.LastName,
                employee.Email, employee.HireDate, DateTimeOffset.UtcNow)),
        });

        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetById), new { id = employee.Id }, employee);
    }

    [HttpPost("{id}/assignments")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> CreateAssignment(Guid id, [FromBody] CreateAssignmentRequest request, CancellationToken ct)
    {
        var employee = await _db.Employees.FirstOrDefaultAsync(e => e.Id == id);
        if (employee is null) return NotFound("Employee not found");

        // Onceki aktif atama (varsa) ele alinir. Uc durum kararlari:
        //   - yeni effectiveFrom, mevcut aktifin effectiveFrom'undan ONCEYSE:
        //     gecersiz istek - iki kayit CAKISIR, veri butunlugunu bozar.
        //   - yeni effectiveFrom AYNI gunse (surukle-birak her zaman "bugun"
        //     gonderir - ayni gun ikinci tasima bu durum): YENI kayit acmak
        //     yerine MEVCUT kaydi GUNCELLE - ayni gun icin iki satir tutmanin
        //     pratik degeri yok, ve "bitis < baslangic" gibi bozuk bir
        //     araliga da yol acardi.
        //   - yeni effectiveFrom SONRAYSA: normal akis (eskiyi kapat, yeni ac).
        var currentActive = await _db.Assignments
            .Where(a => a.EmployeeId == id && a.EffectiveTo == null)
            .FirstOrDefaultAsync();

        // GUVENLIK: Herhangi bir yonetici, herhangi bir calisani herhangi bir
        // departmana tasiyabiliyordu - izin onayi calisanin aktif departmaninin
        // basina gittigi icin bu, onay zincirini istedigi kisiye yonlendirmek
        // demekti. Yonetici yalnizca HENUZ atamasi olmayan (yeni ise alinan)
        // calisani yerlestirebilir; mevcut atamayi degistirmek IK'ya ozel.
        if (currentActive is not null && !IsHr)
            return StatusCode(StatusCodes.Status403Forbidden,
                new { message = "Mevcut bir atamayı yalnızca İK değiştirebilir" });
        if (request.DepartmentId == Guid.Empty)
            return BadRequest(new { message = "Departman zorunlu" });

        if (currentActive is not null && request.EffectiveFrom < currentActive.EffectiveFrom)
            return BadRequest(new
            {
                message = "Başlangıç tarihi, mevcut atamanın başlangıcından önce olamaz",
            });

        Assignment assignment;
        var previousDepartmentId = currentActive?.DepartmentId;

        if (currentActive is not null && request.EffectiveFrom == currentActive.EffectiveFrom)
        {
            currentActive.DepartmentId = request.DepartmentId;
            currentActive.PositionTitle = request.PositionTitle;
            assignment = currentActive;
        }
        else
        {
            if (currentActive is not null)
                currentActive.EffectiveTo = request.EffectiveFrom.AddDays(-1);

            assignment = new Assignment
            {
                EmployeeId = id,
                DepartmentId = request.DepartmentId,
                PositionTitle = request.PositionTitle,
                EffectiveFrom = request.EffectiveFrom
            };
            _db.Assignments.Add(assignment);
        }

        _db.OutboxMessages.Add(new OutboxMessage
        {
            Topic = EmployeeTopics.Events,
            EventType = EmployeeEventTypes.Assigned,
            PartitionKey = id.ToString(),
            Payload = JsonSerializer.Serialize(new EmployeeAssignedEvent(
                _db.CurrentTenantSlug ?? "",
                id, assignment.Id, assignment.DepartmentId,
                assignment.PositionTitle, assignment.EffectiveFrom, DateTimeOffset.UtcNow,
                employee.Email, employee.FirstName, employee.LastName)),
        });

        await _db.SaveChangesAsync();

        // Eski departmanin basi bu calisansa (artik orada degil), bas
        // alanini temizle - best-effort, assignment kaydini engellemez.
        if (previousDepartmentId.HasValue && previousDepartmentId != request.DepartmentId)
            await _organizations.ClearHeadIfMatchesAsync(previousDepartmentId.Value, id, ct);

        return CreatedAtAction(nameof(GetById), new { id }, assignment);
    }
}

public record CreateEmployeeRequest(string FirstName, string LastName, string Email, string? Phone, DateOnly HireDate);
public record CreateAssignmentRequest(Guid DepartmentId, string? PositionTitle, DateOnly EffectiveFrom);
