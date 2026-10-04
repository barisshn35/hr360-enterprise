using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CompensationService.Data;
using CompensationService.Models;
using CompensationService.Tenancy;
using System.Security.Claims;

namespace CompensationService.Controllers;

/// <summary>
/// Ucret verisi hassastir: tum uc noktalar IK yetkisi gerektirir
/// (RequireHrAdmin: hr-admin, tenant-admin, platform-admin; okuma uclari ayrica
/// compensation:view ek iznini kabul eder - bkz. Program.cs).
/// </summary>
[ApiController]
[Route("api/compensation")]
[Authorize(Policy = "RequireHrAdmin")]
public class CompensationController : ControllerBase
{
    private readonly CompensationDbContext _db;
    private readonly ITenantContext _tenant;
    public CompensationController(CompensationDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    /// <summary>KVKK m.12: ücret görüntülemesi hassas veri erişim kaydına yazılır (KVKK › Erişim kayıtları).</summary>
    private async Task LogViewAsync(string entityId, string field)
    {
        try
        {
            var user = HttpContext.User;
            await _db.Database.ExecuteSqlRawAsync(
                "INSERT INTO audit_log (\"TenantSlug\",\"Service\",\"EntityType\",\"EntityId\",\"Action\",\"Changes\",\"UserId\",\"UserName\",\"CorrelationId\",\"IpAddress\",\"OccurredAt\") " +
                "VALUES ({0},'compensation-service','CompensationRecord',{1},'SensitiveViewed',{2}::jsonb,{3},{4},{5},{6},now())",
                (object?)_tenant.TenantSlug ?? DBNull.Value, entityId, $"{{\"field\":\"{field}\"}}",
                user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value ?? "unknown",
                (object?)(user.FindFirst("name")?.Value ?? user.FindFirst("preferred_username")?.Value) ?? DBNull.Value,
                (object?)(Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? HttpContext.TraceIdentifier) ?? DBNull.Value,
                (object?)Request.Headers["X-Real-IP"].FirstOrDefault() ?? DBNull.Value);
        }
        catch (Exception) { /* denetim yazılamazsa iş akışı bozulmaz */ }
    }

    // ---- Ucret bantlari ----

    [HttpGet("bands")]
    public async Task<IActionResult> GetBands([FromQuery] int? year)
    {
        var q = _db.SalaryBands.AsQueryable();
        if (year.HasValue) q = q.Where(b => b.Year == year.Value);
        return Ok(await q.OrderBy(b => b.Grade).ToListAsync());
    }

    [HttpPost("bands")]
    [Authorize(Policy = "RequireCompensationWrite")]
    public async Task<IActionResult> CreateBand([FromBody] CreateBandRequest request)
    {
        if (request.MinAmount <= 0 || request.MinAmount > request.MidAmount || request.MidAmount > request.MaxAmount)
            return BadRequest("Bant değerleri 0 < alt ≤ orta ≤ üst olmalı");

        if (await _db.SalaryBands.AnyAsync(b => b.Grade == request.Grade && b.Year == request.Year))
            return Conflict("Bu kademe ve yıl için bant zaten tanımlı");

        var band = new SalaryBand
        {
            Grade = request.Grade,
            Title = request.Title,
            MinAmount = request.MinAmount,
            MidAmount = request.MidAmount,
            MaxAmount = request.MaxAmount,
            Currency = request.Currency,
            Year = request.Year
        };
        _db.SalaryBands.Add(band);
        await _db.SaveChangesAsync();
        return Created($"/api/compensation/bands/{band.Id}", band);
    }

    /// <summary>Bant değişikliği denetim kaydına yazılır (ücret yapısı hassas iş verisidir).</summary>
    private async Task AuditBandAsync(SalaryBand band, string action)
    {
        try
        {
            var user = HttpContext.User;
            var changes = System.Text.Json.JsonSerializer.Serialize(new { band.Grade, band.Year, band.MinAmount, band.MidAmount, band.MaxAmount, band.Currency });
            await _db.Database.ExecuteSqlRawAsync(
                "INSERT INTO audit_log (\"TenantSlug\",\"Service\",\"EntityType\",\"EntityId\",\"Action\",\"Changes\",\"UserId\",\"UserName\",\"CorrelationId\",\"IpAddress\",\"OccurredAt\") " +
                "VALUES ({0},'compensation-service','SalaryBand',{1},{2},{3}::jsonb,{4},{5},{6},{7},now())",
                (object?)_tenant.TenantSlug ?? DBNull.Value, band.Id.ToString(), action, changes,
                user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value ?? "unknown",
                (object?)(user.FindFirst("name")?.Value ?? user.FindFirst("preferred_username")?.Value) ?? DBNull.Value,
                (object?)(Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? HttpContext.TraceIdentifier) ?? DBNull.Value,
                (object?)Request.Headers["X-Real-IP"].FirstOrDefault() ?? DBNull.Value);
        }
        catch (Exception) { /* denetim yazılamazsa iş akışı bozulmaz */ }
    }

    /// <summary>
    /// Bant kullanımda mı: kademesi bu bant olan geçerli ücret kaydı ya da bandı okuyan
    /// (yılı ya da bir sonraki yılı) henüz uygulanmamış zam dönemi varsa kullanımda sayılır.
    /// </summary>
    private async Task<string?> BandUsageAsync(SalaryBand band)
    {
        if (await _db.Records.AnyAsync(r => r.Grade == band.Grade && r.EffectiveTo == null))
            return "Bu kademede geçerli ücret kaydı olan çalışanlar var";
        if (await _db.RaiseCycles.AnyAsync(c => c.AppliedAt == null && (c.Year == band.Year || c.Year - 1 == band.Year)))
            return "Bu bandı kullanan, henüz uygulanmamış bir zam dönemi var";
        return null;
    }

    [HttpPut("bands/{id:guid}")]
    [Authorize(Policy = "RequireCompensationWrite")]
    public async Task<IActionResult> UpdateBand(Guid id, [FromBody] CreateBandRequest request)
    {
        var band = await _db.SalaryBands.FirstOrDefaultAsync(b => b.Id == id);
        if (band is null) return NotFound();
        if (string.IsNullOrWhiteSpace(request.Grade)) return BadRequest("Kademe boş olamaz");
        if (request.MinAmount <= 0 || request.MinAmount > request.MidAmount || request.MidAmount > request.MaxAmount)
            return BadRequest("Bant değerleri 0 < alt ≤ orta ≤ üst olmalı");
        var grade = request.Grade.Trim();
        if (grade != band.Grade || request.Year != band.Year)
        {
            // Kademe/yıl değişirse kayıtlar ve zam dönemleri bu banttan kopar: kullanımdaysa izin verilmez.
            var usage = await BandUsageAsync(band);
            if (usage is not null) return Conflict($"{usage}; kademe ve yıl değiştirilemez");
            if (await _db.SalaryBands.AnyAsync(b => b.Id != id && b.Grade == grade && b.Year == request.Year))
                return Conflict("Bu kademe ve yıl için bant zaten tanımlı");
        }
        band.Grade = grade;
        band.Title = string.IsNullOrWhiteSpace(request.Title) ? null : request.Title.Trim();
        band.MinAmount = request.MinAmount;
        band.MidAmount = request.MidAmount;
        band.MaxAmount = request.MaxAmount;
        band.Currency = string.IsNullOrWhiteSpace(request.Currency) ? band.Currency : request.Currency;
        band.Year = request.Year;
        await _db.SaveChangesAsync();
        await AuditBandAsync(band, "Updated");
        return Ok(band);
    }

    [HttpDelete("bands/{id:guid}")]
    [Authorize(Policy = "RequireCompensationWrite")]
    public async Task<IActionResult> DeleteBand(Guid id)
    {
        var band = await _db.SalaryBands.FirstOrDefaultAsync(b => b.Id == id);
        if (band is null) return NotFound();
        var usage = await BandUsageAsync(band);
        if (usage is not null) return Conflict($"{usage}; bant silinemez");
        _db.SalaryBands.Remove(band);
        await _db.SaveChangesAsync();
        await AuditBandAsync(band, "Deleted");
        return NoContent();
    }

    // ---- Ucret kayitlari ----

    [HttpGet("records")]
    public async Task<IActionResult> GetRecords([FromQuery] Guid? employeeId)
    {
        var q = _db.Records.AsQueryable();
        if (employeeId.HasValue) q = q.Where(r => r.EmployeeId == employeeId.Value);
        var rows = await q.OrderByDescending(r => r.EffectiveFrom).ToListAsync();
        // Kişi bazında görüntüleme o kişinin erişim kaydına; toplu liste tek satır olarak yazılır.
        await LogViewAsync(employeeId?.ToString() ?? "list", employeeId.HasValue ? "salary" : "salaryList");
        return Ok(rows);
    }

    /// <summary>Yeni ucret kaydi; onceki acik kaydi otomatik kapatir.</summary>
    [HttpPost("records")]
    [Authorize(Policy = "RequireCompensationWrite")]
    public async Task<IActionResult> CreateRecord([FromBody] CreateRecordRequest request)
    {
        if (request.BaseSalary <= 0) return BadRequest("Ucret sifirdan buyuk olmali");

        var current = await _db.Records
            .Where(r => r.EmployeeId == request.EmployeeId && r.EffectiveTo == null)
            .OrderByDescending(r => r.EffectiveFrom)
            .FirstOrDefaultAsync();

        if (current is not null)
        {
            if (request.EffectiveFrom <= current.EffectiveFrom)
                return BadRequest("Yeni kaydın başlangıcı mevcut kayıttan sonra olmalı");
            current.EffectiveTo = request.EffectiveFrom.AddDays(-1);
        }

        var record = new CompensationRecord
        {
            EmployeeId = request.EmployeeId,
            BaseSalary = request.BaseSalary,
            Currency = request.Currency,
            Grade = request.Grade,
            Reason = request.Reason,
            EffectiveFrom = request.EffectiveFrom,
            Note = request.Note
        };
        _db.Records.Add(record);
        await _db.SaveChangesAsync();
        return Created($"/api/compensation/records/{record.Id}", record);
    }

    // ---- Simulasyon ----

    /// <summary>
    /// Zam simulasyonu: verilen calisanlar icin yuzde/tutar bazli artisin
    /// toplam butce etkisini ve bant uyumunu hesaplar. Kayit olusturmaz.
    /// </summary>
    [HttpPost("simulate")]
    public async Task<IActionResult> Simulate([FromBody] SimulationRequest request)
    {
        if (request.EmployeeIds.Count == 0) return BadRequest("En az bir çalışan seçilmeli");

        var current = await _db.Records
            .Where(r => request.EmployeeIds.Contains(r.EmployeeId) && r.EffectiveTo == null)
            .ToListAsync();

        var bands = await _db.SalaryBands
            .Where(b => b.Year == request.Year)
            .ToListAsync();

        var lines = current.Select(r =>
        {
            var proposed = request.IncreasePercent.HasValue
                ? Math.Round(r.BaseSalary * (1 + request.IncreasePercent.Value / 100m), 2)
                : r.BaseSalary + (request.FlatIncrease ?? 0);

            var band = bands.FirstOrDefault(b => b.Grade == r.Grade);
            // Bant atanmamışsa (kademe yok ya da o yıl için bant tanımsız) uyum bilinmez: null.
            bool? withinBand = band is null ? null : proposed >= band.MinAmount && proposed <= band.MaxAmount;

            return new
            {
                employeeId = r.EmployeeId,
                currentSalary = r.BaseSalary,
                proposedSalary = proposed,
                increaseAmount = proposed - r.BaseSalary,
                increasePercent = r.BaseSalary == 0
                    ? 0
                    : Math.Round((proposed - r.BaseSalary) / r.BaseSalary * 100, 2),
                grade = r.Grade,
                withinBand,
                bandMax = band?.MaxAmount
            };
        }).ToList();

        return Ok(new
        {
            employeeCount = lines.Count,
            currentTotal = lines.Sum(l => l.currentSalary),
            proposedTotal = lines.Sum(l => l.proposedSalary),
            budgetImpact = lines.Sum(l => l.increaseAmount),
            outOfBandCount = lines.Count(l => l.withinBand == false),
            noBandCount = lines.Count(l => l.withinBand == null),
            lines
        });
    }
}

public record CreateBandRequest(
    string Grade, string? Title, decimal MinAmount, decimal MidAmount,
    decimal MaxAmount, string Currency, int Year);

public record CreateRecordRequest(
    Guid EmployeeId, decimal BaseSalary, string Currency, string? Grade,
    CompensationChangeReason Reason, DateOnly EffectiveFrom, string? Note);

public record SimulationRequest(
    List<Guid> EmployeeIds, decimal? IncreasePercent, decimal? FlatIncrease, int Year);
