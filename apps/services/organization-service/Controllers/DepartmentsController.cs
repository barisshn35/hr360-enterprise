using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using OrganizationService.Data;
using OrganizationService.Models;

namespace OrganizationService.Controllers;

[ApiController]
[Route("api/departments")]
[Authorize]
public class DepartmentsController : ControllerBase
{
    private readonly OrganizationDbContext _db;

    public DepartmentsController(OrganizationDbContext db)
    {
        _db = db;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? companyId)
    {
        var query = _db.Departments.AsQueryable();
        if (companyId.HasValue) query = query.Where(d => d.CompanyId == companyId.Value);
        return Ok(await query.ToListAsync());
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(Guid id)
    {
        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id);
        return department is null ? NotFound() : Ok(department);
    }

    [Authorize(Policy = "RequireHrAdmin")]
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateDepartmentRequest request)
    {
        var companyExists = await _db.Companies.AnyAsync(c => c.Id == request.CompanyId);
        if (!companyExists) return BadRequest("Company not found");

        var department = new Department
        {
            Name = request.Name,
            CompanyId = request.CompanyId,
            ParentDepartmentId = request.ParentDepartmentId
        };
        _db.Departments.Add(department);
        await _db.SaveChangesAsync();
        return CreatedAtAction(nameof(GetAll), new { companyId = department.CompanyId }, department);
    }

    /// <summary>
    /// Departman adini gunceller. CompanyId/ParentDepartmentId bu uctan
    /// DEGISTIRILEMEZ - departmani baska bir sirkete/ust departmana
    /// tasimak farkli bir islem, sadece isim degisikligiyle karistirilmamali.
    /// </summary>
    [Authorize(Policy = "RequireHrAdmin")]
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateDepartmentRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { message = "Departman adi bos olamaz" });

        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id);
        if (department is null) return NotFound();

        department.Name = request.Name.Trim();
        department.HeadEmployeeId = request.HeadEmployeeId;
        await _db.SaveChangesAsync();
        return Ok(department);
    }

    /// <summary>
    /// Departmani siler.
    ///
    /// GUVENLIK: bu uc silmeyi REDDEDER eger departmanin altinda ekip,
    /// alt departman ya da atanmis calisan varsa. Sebep: veritabaninda
    /// organization_teams.DepartmentId ON DELETE CASCADE - departmani
    /// silmek EKIPLERI DE SESSIZCE goturur, kullaniciya sormadan.
    /// ParentDepartmentId ve employee_assignments.DepartmentId'nin ise
    /// hic FK kisiti yok - silinirse bu alanlar YETIM kalir, hicbir hata
    /// vermez ama veri tutarsizligi yaratir.
    ///
    /// Once ilgili kayitlarin tasinmasi/kaldirilmasi istenir.
    /// </summary>
    [Authorize(Policy = "RequireHrAdmin")]
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var department = await _db.Departments.FirstOrDefaultAsync(d => d.Id == id);
        if (department is null) return NotFound();

        var childDepartmentCount = await _db.Departments.CountAsync(d => d.ParentDepartmentId == id);
        var teamCount = await _db.Teams.CountAsync(t => t.DepartmentId == id);

        // employee_assignments ayri bir mikroservisin tablosu ama ayni
        // fiziksel veritabanini paylasiyoruz - salt okunur bir sayim
        // icin ayri bir HTTP servisi kurmaya gerek yok.
        var assignedEmployeeCount = await _db.Database
            .SqlQuery<int>($@"SELECT COUNT(*)::int AS ""Value"" FROM employee_assignments
                               WHERE ""DepartmentId"" = {id}")
            .FirstAsync();

        var blockers = new List<string>();
        if (childDepartmentCount > 0) blockers.Add($"{childDepartmentCount} alt departman");
        if (teamCount > 0) blockers.Add($"{teamCount} ekip");
        if (assignedEmployeeCount > 0) blockers.Add($"{assignedEmployeeCount} atanmis calisan");

        if (blockers.Count > 0)
        {
            return Conflict(new
            {
                message = "Departman silinemedi: once su kayitlarin tasinmasi ya da " +
                          $"kaldirilmasi gerekiyor: {string.Join(", ", blockers)}.",
                childDepartmentCount,
                teamCount,
                assignedEmployeeCount,
            });
        }

        _db.Departments.Remove(department);
        await _db.SaveChangesAsync();
        return NoContent();
    }
}

public record CreateDepartmentRequest(string Name, Guid CompanyId, Guid? ParentDepartmentId);
public record UpdateDepartmentRequest(string Name, Guid? HeadEmployeeId = null);
