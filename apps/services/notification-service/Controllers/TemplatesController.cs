using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NotificationService.Data;
using NotificationService.Models;

namespace NotificationService.Controllers;

[ApiController]
[Route("api/notification-templates")]
[Authorize(Policy = "RequireHrAdmin")]
public class TemplatesController : ControllerBase
{
    private readonly NotificationDbContext _db;
    public TemplatesController(NotificationDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
        => Ok(await _db.Templates.OrderBy(t => t.Code).ToListAsync());

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateTemplateRequest request)
    {
        var locale = request.Locale ?? "tr";
        if (await _db.Templates.AnyAsync(t =>
                t.Code == request.Code && t.Channel == request.Channel && t.Locale == locale))
            return Conflict("Bu kod/kanal/dil kombinasyonu icin sablon zaten var");

        var tpl = new NotificationTemplate
        {
            Code = request.Code,
            Channel = request.Channel,
            Locale = locale,
            SubjectTemplate = request.SubjectTemplate,
            BodyTemplate = request.BodyTemplate
        };
        _db.Templates.Add(tpl);
        await _db.SaveChangesAsync();
        return Created($"/api/notification-templates/{tpl.Id}", tpl);
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Deactivate(Guid id)
    {
        var tpl = await _db.Templates.FirstOrDefaultAsync(t => t.Id == id);
        if (tpl is null) return NotFound();
        tpl.IsActive = false;
        await _db.SaveChangesAsync();
        return NoContent();
    }
}

public record CreateTemplateRequest(
    string Code, NotificationChannel Channel, string? Locale,
    string? SubjectTemplate, string BodyTemplate);
