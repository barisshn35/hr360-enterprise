using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using LearningService.Data;
using LearningService.Models;

namespace LearningService.Controllers;

[ApiController]
[Route("api/certifications")]
[Authorize]
public class CertificationsController : ControllerBase
{
    private readonly LearningDbContext _db;
    public CertificationsController(LearningDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId)
    {
        var q = _db.Certifications.AsQueryable();
        if (employeeId.HasValue) q = q.Where(c => c.EmployeeId == employeeId.Value);
        return Ok(await q.OrderByDescending(c => c.IssuedOn).ToListAsync());
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCertificationRequest request)
    {
        if (request.ExpiresOn.HasValue && request.ExpiresOn < request.IssuedOn)
            return BadRequest("Gecerlilik bitisi, veril tarihinden once olamaz");

        var cert = new Certification
        {
            EmployeeId = request.EmployeeId,
            Name = request.Name,
            Issuer = request.Issuer,
            CredentialId = request.CredentialId,
            IssuedOn = request.IssuedOn,
            ExpiresOn = request.ExpiresOn
        };
        _db.Certifications.Add(cert);
        await _db.SaveChangesAsync();
        return Created($"/api/certifications/{cert.Id}", cert);
    }

    /// <summary>Belirtilen gun icinde suresi dolacak sertifikalar.</summary>
    [HttpGet("expiring")]
    [Authorize(Policy = "RequireManagerOrAbove")]
    public async Task<IActionResult> GetExpiring([FromQuery] int withinDays = 90)
    {
        var limit = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(withinDays));
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var list = await _db.Certifications
            .Where(c => c.ExpiresOn != null && c.ExpiresOn <= limit)
            .OrderBy(c => c.ExpiresOn)
            .ToListAsync();

        return Ok(list.Select(c => new
        {
            c.Id,
            c.EmployeeId,
            c.Name,
            c.Issuer,
            c.ExpiresOn,
            expired = c.ExpiresOn < today,
            daysRemaining = c.ExpiresOn!.Value.DayNumber - today.DayNumber
        }));
    }
}

public record CreateCertificationRequest(
    Guid EmployeeId, string Name, string? Issuer, string? CredentialId,
    DateOnly IssuedOn, DateOnly? ExpiresOn);
