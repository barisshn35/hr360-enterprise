using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ExpenseService.Data;
using ExpenseService.Models;

namespace ExpenseService.Controllers;

/// <summary>
/// Ozluk dokumani metadata'si. Dosyanin kendisi MinIO'da tutulur;
/// bu servis yalnizca kaydi yonetir (StorageKey ile baglanti).
/// </summary>
[ApiController]
[Route("api/documents")]
[Authorize]
public class DocumentsController : ControllerBase
{
    private readonly ExpenseDbContext _db;
    public DocumentsController(ExpenseDbContext db) => _db = db;

    [HttpGet]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> GetAll([FromQuery] Guid? employeeId, [FromQuery] DocumentType? type)
    {
        var q = _db.Documents.AsQueryable();
        if (employeeId.HasValue) q = q.Where(d => d.EmployeeId == employeeId.Value);
        if (type.HasValue) q = q.Where(d => d.Type == type.Value);
        return Ok(await q.OrderByDescending(d => d.UploadedAt).ToListAsync());
    }

    [HttpPost]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> Create([FromBody] CreateDocumentRequest request)
    {
        var doc = new Document
        {
            EmployeeId = request.EmployeeId,
            Type = request.Type,
            FileName = request.FileName,
            StorageKey = request.StorageKey,
            SizeBytes = request.SizeBytes,
            ContentType = request.ContentType,
            UploadedByEmployeeId = request.UploadedByEmployeeId
        };
        _db.Documents.Add(doc);
        await _db.SaveChangesAsync();
        return Created($"/api/documents/{doc.Id}", doc);
    }

    [HttpDelete("{id}")]
    [Authorize(Policy = "RequireDocumentManage")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var doc = await _db.Documents.FirstOrDefaultAsync(d => d.Id == id);
        if (doc is null) return NotFound();
        _db.Documents.Remove(doc);
        await _db.SaveChangesAsync();
        // Not: MinIO'daki dosyanin silinmesi ayri bir temizlik isi olarak yapilmali.
        return NoContent();
    }
}

public record CreateDocumentRequest(
    Guid EmployeeId, DocumentType Type, string FileName, string StorageKey,
    long SizeBytes, string? ContentType, Guid? UploadedByEmployeeId);
