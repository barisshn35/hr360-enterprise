using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using CompensationService.Data;
using CompensationService.Models;
using CompensationService.Payroll;
using CompensationService.Tenancy;

namespace CompensationService.Controllers;

/// <summary>
/// Bordro dönemi: parametreler, dönem açma, hesaplama, ek ödeme/kesinti, kapatma ve
/// bordro pusulası.
///
/// KVKK: Pusulayı yalnızca çalışanın kendisi (dönem kapandıktan sonra) ve bordro yetkilisi
/// (İK) görür. İK'nın başkasının pusulasını ya da dönem listesini açması hassas veri erişim
/// kaydına yazılır. Pusulalar saklama politikasındaki süre dolunca imha edilir (KVKK ›
/// Saklama politikaları › "Bordro pusulaları").
/// </summary>
[ApiController]
[Route("api/compensation")]
[Authorize]
public class PayrollController : ControllerBase
{
    private readonly CompensationDbContext _db;
    private readonly ITenantContext _tenant;
    public PayrollController(CompensationDbContext db, ITenantContext tenant) { _db = db; _tenant = tenant; }

    private bool IsPayrollAdmin => User.IsInRole("hr-admin") || User.IsInRole("tenant-admin") || User.IsInRole("platform-admin");
    private bool IsPayrollViewer => IsPayrollAdmin || User.IsInRole("ext-compensation-view");
    private string UserId => User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("sub")?.Value ?? "unknown";
    private string? UserName => User.FindFirst("name")?.Value ?? User.FindFirst("preferred_username")?.Value;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    // tenant: kaydın kiracısı. Platform yöneticisinin oturumunda kiracı olmadığından kayıt kendi kiracısına yazılır
    // (aksi halde şirketin erişim kayıtlarında görünmüyordu).
    private async Task AuditAsync(string entityType, string entityId, string action, object changes, string? tenant = null)
    {
        try
        {
            await _db.Database.ExecuteSqlRawAsync(
                "INSERT INTO audit_log (\"TenantSlug\",\"Service\",\"EntityType\",\"EntityId\",\"Action\",\"Changes\",\"UserId\",\"UserName\",\"CorrelationId\",\"IpAddress\",\"OccurredAt\") " +
                "VALUES ({0},'compensation-service',{1},{2},{3},{4}::jsonb,{5},{6},{7},{8},now())",
                (object?)(tenant ?? _tenant.TenantSlug) ?? DBNull.Value, entityType, entityId, action, JsonSerializer.Serialize(changes, Json),
                UserId, (object?)UserName ?? DBNull.Value,
                (object?)(Request.Headers["X-Correlation-Id"].FirstOrDefault() ?? HttpContext.TraceIdentifier) ?? DBNull.Value,
                (object?)Request.Headers["X-Real-IP"].FirstOrDefault() ?? DBNull.Value);
        }
        catch (Exception ex)
        {
            // Denetim yazılamazsa iş akışı bozulmaz; ama sessizce yutulmaz (KVKK erişim kaydı eksik kalır).
            HttpContext.RequestServices.GetService<ILogger<PayrollAudit>>()?.LogWarning(ex, "audit_log yazılamadı: {EntityType} {Action}", entityType, action);
        }
    }

    private async Task<Guid?> MyEmployeeIdAsync(CancellationToken ct)
    {
        var sub = User.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub) || string.IsNullOrEmpty(_tenant.TenantSlug)) return null;
        return await _db.Database.SqlQueryRaw<Guid?>(
            "SELECT \"Id\" AS \"Value\" FROM employee_employees WHERE \"TenantSlug\" = {0} AND \"KeycloakUserId\" = {1} LIMIT 1",
            _tenant.TenantSlug, sub).FirstOrDefaultAsync(ct);
    }

    // ------------------------------------------------------------------ parametreler

    private async Task<PayrollParams> ParamsAsync(int year, CancellationToken ct)
    {
        var d = PayrollDefaults.For(year);
        var row = await _db.PayrollParameters.AsNoTracking().FirstOrDefaultAsync(p => p.Year == year, ct);
        if (row is null) return d;
        var brackets = JsonSerializer.Deserialize<List<TaxBracket>>(row.BracketsJson, Json);
        return d with
        {
            MinimumWageGross = row.MinimumWageGross, SgkEmployerRate = row.SgkEmployerRate,
            EmployerIncentivePoints = row.EmployerIncentivePoints, StampTaxRate = row.StampTaxRate,
            SgkCeilingMultiplier = row.SgkCeilingMultiplier,
            Brackets = brackets is { Count: > 0 } ? brackets : d.Brackets,
        };
    }

    [HttpGet("payroll/parameters/{year:int}")]
    public async Task<IActionResult> GetParameters(int year, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        if (year is < 2020 or > 2100) return BadRequest(new { message = "Geçersiz yıl" });
        var custom = await _db.PayrollParameters.AsNoTracking().AnyAsync(p => p.Year == year, ct);
        var p = await ParamsAsync(year, ct);
        return Ok(new
        {
            p.Year, p.MinimumWageGross, p.SgkEmployeeRate, p.UnemploymentEmployeeRate, p.SgkEmployerRate, p.EmployerIncentivePoints,
            effectiveEmployerSgkRate = p.EffectiveEmployerSgkRate, p.UnemploymentEmployerRate, p.StampTaxRate, p.SgkCeilingMultiplier,
            sgkCeiling = Math.Round(p.MinimumWageGross * p.SgkCeilingMultiplier, 2), p.OvertimeMultiplier, p.MonthlyHours,
            brackets = p.Brackets, isCustom = custom,
        });
    }

    public record ParametersInput(decimal MinimumWageGross, decimal SgkEmployerRate, decimal EmployerIncentivePoints,
        decimal StampTaxRate, decimal SgkCeilingMultiplier, List<TaxBracket> Brackets);

    [HttpPut("payroll/parameters/{year:int}")]
    public async Task<IActionResult> PutParameters(int year, [FromBody] ParametersInput body, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        if (year is < 2020 or > 2100) return BadRequest(new { message = "Geçersiz yıl" });
        if (body.MinimumWageGross <= 0 || body.SgkEmployerRate is < 0 or > 1 || body.StampTaxRate is < 0 or > 0.1m
            || body.EmployerIncentivePoints is < 0 or > 20 || body.SgkCeilingMultiplier is < 1 or > 20)
            return BadRequest(new { message = "Parametre değerleri geçersiz" });
        var br = body.Brackets ?? new();
        if (br.Count is < 1 or > 10 || br[^1].UpTo is not null || br.Any(b => b.Rate is < 0 or > 1)
            || br.Take(br.Count - 1).Any(b => b.UpTo is null or <= 0)
            || br.Take(br.Count - 1).Zip(br.Skip(1).Take(br.Count - 2)).Any(x => x.First.UpTo >= x.Second.UpTo))
            return BadRequest(new { message = "Vergi dilimleri artan sınırlarla girilmeli; son dilimin üst sınırı boş olmalı" });
        var row = await _db.PayrollParameters.FirstOrDefaultAsync(p => p.Year == year, ct);
        if (row is null) { row = new PayrollParameterSet { Year = year }; _db.PayrollParameters.Add(row); }
        row.MinimumWageGross = body.MinimumWageGross; row.SgkEmployerRate = body.SgkEmployerRate;
        row.EmployerIncentivePoints = body.EmployerIncentivePoints; row.StampTaxRate = body.StampTaxRate;
        row.SgkCeilingMultiplier = body.SgkCeilingMultiplier; row.BracketsJson = JsonSerializer.Serialize(br, Json);
        row.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        return await GetParameters(year, ct);
    }

    [HttpDelete("payroll/parameters/{year:int}")]
    public async Task<IActionResult> ResetParameters(int year, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var row = await _db.PayrollParameters.FirstOrDefaultAsync(p => p.Year == year, ct);
        if (row is not null) { _db.PayrollParameters.Remove(row); await _db.SaveChangesAsync(ct); }
        return NoContent();
    }

    /// <summary>Kayıt oluşturmadan tek kişilik brütten nete hesap (simülasyon).</summary>
    public record PreviewInput(int Year, int Month, decimal MonthlyGross, int UnpaidDays, decimal OvertimeHours, decimal Additions, decimal Deductions, decimal PriorCumulativeTaxBase);

    [HttpPost("payroll/preview")]
    public async Task<IActionResult> Preview([FromBody] PreviewInput body, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        if (body.Month is < 1 or > 12 || body.MonthlyGross <= 0 || body.UnpaidDays is < 0 or > 30)
            return BadRequest(new { message = "Geçersiz girdi" });
        var p = await ParamsAsync(body.Year, ct);
        return Ok(PayrollCalculator.Calculate(p, new PayrollInput(body.Month, body.MonthlyGross, body.UnpaidDays,
            body.OvertimeHours, body.Additions, body.Deductions, body.PriorCumulativeTaxBase)));
    }

    // ------------------------------------------------------------------ dönemler

    [HttpGet("payroll/periods")]
    public async Task<IActionResult> Periods([FromQuery] int? year, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        var q = _db.PayrollPeriods.AsNoTracking();
        if (year.HasValue) q = q.Where(p => p.Year == year);
        var periods = await q.OrderByDescending(p => p.Year).ThenByDescending(p => p.Month).ToListAsync(ct);
        var ids = periods.Select(p => p.Id).ToList();
        var totals = await _db.Payslips.AsNoTracking().Where(s => ids.Contains(s.PeriodId))
            .GroupBy(s => s.PeriodId)
            .Select(g => new { PeriodId = g.Key, Count = g.Count(), Gross = g.Sum(s => s.Gross), Net = g.Sum(s => s.Net), Cost = g.Sum(s => s.EmployerCost) })
            .ToListAsync(ct);
        return Ok(periods.Select(p =>
        {
            var t = totals.FirstOrDefault(x => x.PeriodId == p.Id);
            return new { p.Id, p.Year, p.Month, status = p.Status.ToString(), p.CalculatedAt, calculatedBy = p.CalculatedByName, p.ClosedAt, p.ClosedBy,
                employeeCount = t?.Count ?? 0, totalGross = t?.Gross ?? 0, totalNet = t?.Net ?? 0, totalEmployerCost = t?.Cost ?? 0 };
        }));
    }

    public record PeriodInput(int Year, int Month);

    [HttpPost("payroll/periods")]
    public async Task<IActionResult> CreatePeriod([FromBody] PeriodInput body, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        if (body.Month is < 1 or > 12 || body.Year is < 2020 or > 2100) return BadRequest(new { message = "Geçersiz dönem" });
        if (await _db.PayrollPeriods.AnyAsync(p => p.Year == body.Year && p.Month == body.Month, ct))
            return Conflict(new { message = "Bu dönem zaten açık" });
        var p = new PayrollPeriod { Year = body.Year, Month = body.Month };
        _db.PayrollPeriods.Add(p);
        await _db.SaveChangesAsync(ct);
        return Ok(new { p.Id, p.Year, p.Month, status = p.Status.ToString() });
    }

    private async Task<(IActionResult? Error, PayrollPeriod? Period)> EditablePeriodAsync(Guid id, CancellationToken ct)
    {
        var p = await _db.PayrollPeriods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (p is null) return (NotFound(new { message = "Dönem bulunamadı" }), null);
        if (p.Status == PayrollPeriodStatus.Closed)
            return (Conflict(new { message = "Kilitli bordro dönemi değiştirilemez", code = "period_closed" }), null);
        return (null, p);
    }

    /// <summary>Kapanmamış dönemi siler (pusulalar ve ek ödeme/kesintilerle birlikte).</summary>
    [HttpDelete("payroll/periods/{id:guid}")]
    public async Task<IActionResult> DeletePeriod(Guid id, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var (err, period) = await EditablePeriodAsync(id, ct);
        if (err is not null) return err;
        await _db.Payslips.Where(s => s.PeriodId == id).ExecuteDeleteAsync(ct);
        await _db.PayrollAdjustments.Where(a => a.PeriodId == id).ExecuteDeleteAsync(ct);
        _db.PayrollPeriods.Remove(period!);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    public record AdjustmentInput(Guid EmployeeId, PayrollAdjustmentKind Kind, decimal Amount, string Description);

    [HttpGet("payroll/periods/{id:guid}/adjustments")]
    public async Task<IActionResult> Adjustments(Guid id, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        return Ok(await _db.PayrollAdjustments.AsNoTracking().Where(a => a.PeriodId == id).OrderBy(a => a.CreatedAt).ToListAsync(ct));
    }

    [HttpPost("payroll/periods/{id:guid}/adjustments")]
    public async Task<IActionResult> AddAdjustment(Guid id, [FromBody] AdjustmentInput body, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var (err, period) = await EditablePeriodAsync(id, ct);
        if (err is not null) return err;
        if (body.Amount is <= 0 or > 100_000_000) return BadRequest(new { message = "Tutar sıfırdan büyük olmalı" });
        if (string.IsNullOrWhiteSpace(body.Description) || body.Description.Length > 200) return BadRequest(new { message = "Açıklama gerekli (en fazla 200 karakter)" });
        var a = new PayrollAdjustment { PeriodId = id, EmployeeId = body.EmployeeId, Kind = body.Kind, Amount = Math.Round(body.Amount, 2), Description = body.Description.Trim(), CreatedBy = UserId };
        _db.PayrollAdjustments.Add(a);
        RequireRecalculation(period!);
        await _db.SaveChangesAsync(ct);
        return Ok(a);
    }

    [HttpDelete("payroll/periods/{id:guid}/adjustments/{adjId:guid}")]
    public async Task<IActionResult> DeleteAdjustment(Guid id, Guid adjId, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var (err, period) = await EditablePeriodAsync(id, ct);
        if (err is not null) return err;
        var a = await _db.PayrollAdjustments.FirstOrDefaultAsync(x => x.Id == adjId && x.PeriodId == id, ct);
        if (a is null) return NotFound();
        _db.PayrollAdjustments.Remove(a);
        RequireRecalculation(period!);
        await _db.SaveChangesAsync(ct);
        return NoContent();
    }

    /// <summary>Hesaplanmış dönemde girdi değişirse pusulalar eskir: dönem "Açık"a döner, kapatmadan
    /// önce yeniden hesaplanması gerekir (aksi halde silinen ek ödeme kesinleşen bordroda kalıyordu).</summary>
    private static void RequireRecalculation(PayrollPeriod period)
    {
        if (period.Status == PayrollPeriodStatus.Calculated) period.Status = PayrollPeriodStatus.Open;
    }

    /// <summary>
    /// Dönemi hesaplar: dönem sonunda geçerli ücret kaydı olan herkes için pusula üretir (önceki
    /// hesap silinip yeniden yapılır). Girdiler: onaylı ücretsiz izin günleri (eksik gün), onaylı
    /// fazla mesai saatleri (onaysız fazla mesai girmez), dönemin ek ödeme/kesintileri ve aynı yılın
    /// önceki dönemlerinden kümülatif GV matrahı.
    /// </summary>
    [HttpPost("payroll/periods/{id:guid}/calculate")]
    public async Task<IActionResult> Calculate(Guid id, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var (err, period) = await EditablePeriodAsync(id, ct);
        if (err is not null) return err;
        var tenant = _tenant.TenantSlug ?? "";
        var start = new DateOnly(period!.Year, period.Month, 1);
        var end = start.AddMonths(1).AddDays(-1);
        var p = await ParamsAsync(period.Year, ct);

        var records = await _db.Records.AsNoTracking()
            .Where(r => r.EffectiveFrom <= end && (r.EffectiveTo == null || r.EffectiveTo >= start))
            .ToListAsync(ct);
        var current = records.GroupBy(r => r.EmployeeId).Select(g => g.OrderByDescending(r => r.EffectiveFrom).First()).ToList();

        // Dönem başlamadan ayrılmış çalışanlar hesaplanmaz.
        var leftBefore = (await _db.Database.SqlQueryRaw<Guid>("""
            SELECT e."Id" AS "Value" FROM employee_employees e
            WHERE e."TenantSlug" = {0} AND e."Status" = 'Terminated'
              AND coalesce((SELECT max(a."EffectiveTo") FROM employee_assignments a WHERE a."EmployeeId" = e."Id"), e."CreatedAt"::date) < {1}
            """, tenant, start).ToListAsync(ct)).ToHashSet();
        current = current.Where(r => !leftBefore.Contains(r.EmployeeId)).ToList();
        var empIds = current.Select(r => r.EmployeeId).ToArray();

        // Eksik gün: onaylı ücretsiz izinlerin bu aya düşen takvim günleri.
        var unpaid = await _db.Database.SqlQueryRaw<EmpNumber>("""
            SELECT "EmployeeId", sum(least("EndDate", {2}) - greatest("StartDate", {1}) + 1)::numeric AS "Value"
            FROM leave_requests
            WHERE "TenantSlug" = {0} AND "Type" = 'Unpaid' AND "Status" = 'Approved' AND "StartDate" <= {2} AND "EndDate" >= {1}
            GROUP BY "EmployeeId"
            """, tenant, start, end).ToListAsync(ct);
        // Fazla mesai: yalnızca onaylı talepler (timeshift-service).
        var overtime = await _db.Database.SqlQueryRaw<EmpNumber>("""
            SELECT "EmployeeId", sum("Hours") AS "Value" FROM timeshift_overtime_requests
            WHERE "TenantSlug" = {0} AND "Status" = 'Approved' AND "Date" BETWEEN {1} AND {2}
            GROUP BY "EmployeeId"
            """, tenant, start, end).ToListAsync(ct);
        // Y11: onaylı avans/borç taksitleri bu dönemin kesintisi olarak (kaynağı avans) yeniden yazılır.
        var advanceIds = await _db.Advances.Where(a => a.Status == AdvanceStatus.Approved).Select(a => a.Id).ToListAsync(ct);
        await _db.PayrollAdjustments.Where(a => a.PeriodId == id && a.SourceId != null && advanceIds.Contains(a.SourceId.Value)).ExecuteDeleteAsync(ct);
        foreach (var adv in await _db.Advances.AsNoTracking().Where(a => a.Status == AdvanceStatus.Approved).ToListAsync(ct))
        {
            var idx = Exporters.InstallmentIndex(adv, period.Year, period.Month);
            if (idx < 0 || !empIds.Contains(adv.EmployeeId)) continue;
            _db.PayrollAdjustments.Add(new PayrollAdjustment
            {
                PeriodId = id, EmployeeId = adv.EmployeeId, Kind = PayrollAdjustmentKind.Deduction, SourceId = adv.Id,
                Amount = Exporters.Installment(adv.Amount, adv.Installments, idx),
                Description = $"{(adv.Kind == "Loan" ? "Borç" : "Avans")} taksiti {idx + 1}/{adv.Installments}",
            });
        }
        await _db.SaveChangesAsync(ct);
        var adjustments = await _db.PayrollAdjustments.AsNoTracking().Where(a => a.PeriodId == id).ToListAsync(ct);
        var prior = await _db.Payslips.AsNoTracking()
            .Where(s => s.Year == period.Year && s.Month < period.Month)
            .GroupBy(s => s.EmployeeId).Select(g => new { EmployeeId = g.Key, Base = g.Sum(s => s.TaxBase) })
            .ToListAsync(ct);

        await _db.Payslips.Where(s => s.PeriodId == id).ExecuteDeleteAsync(ct);
        foreach (var r in current)
        {
            var input = new PayrollInput(period.Month, r.BaseSalary,
                (int)Math.Min(30, unpaid.FirstOrDefault(u => u.EmployeeId == r.EmployeeId)?.Value ?? 0),
                overtime.FirstOrDefault(o => o.EmployeeId == r.EmployeeId)?.Value ?? 0,
                adjustments.Where(a => a.EmployeeId == r.EmployeeId && a.Kind == PayrollAdjustmentKind.Addition).Sum(a => a.Amount),
                adjustments.Where(a => a.EmployeeId == r.EmployeeId && a.Kind == PayrollAdjustmentKind.Deduction).Sum(a => a.Amount),
                prior.FirstOrDefault(x => x.EmployeeId == r.EmployeeId)?.Base ?? 0);
            var x = PayrollCalculator.Calculate(p, input);
            _db.Payslips.Add(new Payslip
            {
                PeriodId = id, EmployeeId = r.EmployeeId, Year = period.Year, Month = period.Month, Currency = r.Currency,
                MonthlyBaseGross = r.BaseSalary, PaidDays = x.PaidDays, UnpaidDays = 30 - x.PaidDays, OvertimeHours = input.OvertimeHours,
                BaseGross = x.BaseGross, OvertimePay = x.OvertimePay, Additions = x.Additions, Gross = x.Gross, SgkBase = x.SgkBase,
                SgkEmployee = x.SgkEmployee, UnemploymentEmployee = x.UnemploymentEmployee, TaxBase = x.TaxBase,
                CumulativeTaxBase = x.CumulativeTaxBase, IncomeTax = x.IncomeTax, IncomeTaxExemption = x.IncomeTaxExemption,
                StampTax = x.StampTax, StampTaxExemption = x.StampTaxExemption, Deductions = x.Deductions, Net = x.Net,
                SgkEmployer = x.SgkEmployer, UnemploymentEmployer = x.UnemploymentEmployer, EmployerCost = x.EmployerCost,
            });
        }
        period.Status = PayrollPeriodStatus.Calculated;
        period.CalculatedAt = DateTimeOffset.UtcNow;
        // Görevler ayrılığı: hazırlayan kayda geçer, aynı kişi dönemi kapatamaz.
        period.CalculatedBy = UserId;
        period.CalculatedByName = UserName ?? UserId;
        await _db.SaveChangesAsync(ct);
        return Ok(new { period.Id, status = period.Status.ToString(), employeeCount = current.Count });
    }

    /// <summary>Dönem kapanınca avans taksitleri ödenmiş sayılır (yeniden açılırsa geri alınır).</summary>
    private async Task ApplyAdvanceRepaymentsAsync(Guid periodId, int sign, CancellationToken ct)
    {
        var sourced = await _db.PayrollAdjustments.AsNoTracking().Where(a => a.PeriodId == periodId && a.SourceId != null).ToListAsync(ct);
        if (sourced.Count == 0) return;
        var ids = sourced.Select(a => a.SourceId!.Value).Distinct().ToList();
        foreach (var adv in await _db.Advances.Where(a => ids.Contains(a.Id)).ToListAsync(ct))
        {
            adv.RepaidAmount = Math.Max(0, adv.RepaidAmount + sign * sourced.Where(x => x.SourceId == adv.Id).Sum(x => x.Amount));
            if (adv.RepaidAmount >= adv.Amount && adv.Status == AdvanceStatus.Approved) adv.Status = AdvanceStatus.Closed;
            else if (adv.RepaidAmount < adv.Amount && adv.Status == AdvanceStatus.Closed) adv.Status = AdvanceStatus.Approved;
        }
    }

    public sealed class EmpNumber { public Guid EmployeeId { get; set; } public decimal Value { get; set; } }

    [HttpPost("payroll/periods/{id:guid}/close")]
    public async Task<IActionResult> Close(Guid id, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var (err, period) = await EditablePeriodAsync(id, ct);
        if (err is not null) return err;
        if (period!.Status != PayrollPeriodStatus.Calculated) return BadRequest(new { message = "Önce dönemi hesaplayın" });
        var sod = await SodViolationAsync(period, ct);
        if (sod is not null)
        {
            await AuditAsync("PayrollPeriod", id.ToString(), "SodBlocked", new { period.Year, period.Month, code = sod.Code }, period.TenantSlug);
            return Conflict(new { message = sod.Message, code = sod.Code });
        }
        period.Status = PayrollPeriodStatus.Closed;
        period.ClosedAt = DateTimeOffset.UtcNow;
        period.ClosedBy = UserName ?? UserId;
        await ApplyAdvanceRepaymentsAsync(id, +1, ct);
        await _db.SaveChangesAsync(ct);
        await AuditAsync("PayrollPeriod", id.ToString(), "Closed", new { period.Year, period.Month }, period.TenantSlug);
        return Ok(new { period.Id, status = period.Status.ToString(), period.ClosedAt });
    }

    /// <summary>Kiracının görevler ayrılığı ayarı (governance-service yazar; satır yoksa ya da okunamazsa kural AÇIK).</summary>
    private async Task<bool> SodEnforcedAsync(CancellationToken ct)
    {
        try
        {
            var v = await _db.Database.SqlQueryRaw<bool>(
                "SELECT \"PayrollSod\" AS \"Value\" FROM governance_security_settings WHERE \"TenantSlug\" = {0}", _tenant.TenantSlug ?? "")
                .ToListAsync(ct);
            return v.Count == 0 || v[0];
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return true;
        }
    }

    /// <summary>
    /// Görevler ayrılığı denetimi: hesaplayan / elle kalem giren kapatamaz; ayrıca bu dönemde ilk kez
    /// uygulanacak IBAN değişikliğini yapan kişi de kapatamaz. IBAN değişikliği engagement-service'in
    /// denetim kaydından (audit_log, EmployeeProfile, "Iban" alanı değişti) okunur: önceki kapanmış
    /// dönemden bu yana değişen ve bu dönemde pusulası olan çalışanlar sayılır.
    /// </summary>
    private async Task<SegregationOfDuties.Violation?> SodViolationAsync(PayrollPeriod period, CancellationToken ct)
    {
        if (!await SodEnforcedAsync(ct)) return null;
        var authors = await _db.PayrollAdjustments.AsNoTracking()
            .Where(a => a.PeriodId == period.Id && a.SourceId == null && a.CreatedBy != null)
            .Select(a => a.CreatedBy!).Distinct().ToListAsync(ct);
        var since = await _db.PayrollPeriods.AsNoTracking()
            .Where(p => p.Id != period.Id && p.ClosedAt != null)
            .MaxAsync(p => (DateTimeOffset?)p.ClosedAt, ct) ?? DateTimeOffset.MinValue;
        var ibanEdits = 0;
        try
        {
            ibanEdits = await _db.Database.SqlQueryRaw<int>("""
                SELECT count(DISTINCT pr."EmployeeId")::int AS "Value"
                FROM audit_log l
                JOIN engagement_profiles pr ON pr."Id"::text = l."EntityId" AND pr."TenantSlug" = l."TenantSlug"
                WHERE l."TenantSlug" = {0} AND l."Service" = 'engagement-service' AND l."EntityType" = 'EmployeeProfile'
                  AND l."Action" IN ('Created', 'Updated') AND l."Changes" ? 'Iban'
                  AND l."UserId" = {1} AND l."OccurredAt" > {2}
                  AND pr."EmployeeId" IN (SELECT s."EmployeeId" FROM compensation_payslips s WHERE s."PeriodId" = {3})
                """, period.TenantSlug, UserId, since == DateTimeOffset.MinValue ? new DateTimeOffset(2000, 1, 1, 0, 0, 0, TimeSpan.Zero) : since, period.Id)
                .FirstAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            HttpContext.RequestServices.GetService<ILogger<PayrollAudit>>()?.LogWarning(ex, "IBAN değişikliği denetimi okunamadı");
        }
        return SegregationOfDuties.Evaluate(new SegregationOfDuties.CloseCheck(UserId, period.CalculatedBy, authors, ibanEdits), enforced: true);
    }

    public record ReopenInput(string Reason);

    /// <summary>Kapanmış dönemi yeniden açma: yalnızca kiracı yöneticisi, gerekçe zorunlu, denetim kaydına yazılır.</summary>
    [HttpPost("payroll/periods/{id:guid}/reopen")]
    public async Task<IActionResult> Reopen(Guid id, [FromBody] ReopenInput body, CancellationToken ct)
    {
        if (!(User.IsInRole("tenant-admin") || User.IsInRole("platform-admin"))) return Forbid();
        if (string.IsNullOrWhiteSpace(body.Reason) || body.Reason.Trim().Length < 10)
            return BadRequest(new { message = "Yeniden açma gerekçesi en az 10 karakter olmalı" });
        var period = await _db.PayrollPeriods.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (period is null) return NotFound();
        if (period.Status != PayrollPeriodStatus.Closed) return BadRequest(new { message = "Dönem kapalı değil" });
        period.Status = PayrollPeriodStatus.Calculated;
        period.ClosedAt = null; period.ClosedBy = null;
        await ApplyAdvanceRepaymentsAsync(id, -1, ct);
        await _db.SaveChangesAsync(ct);
        await AuditAsync("PayrollPeriod", id.ToString(), "Reopened", new { period.Year, period.Month, reason = body.Reason.Trim() }, period.TenantSlug);
        return Ok(new { period.Id, status = period.Status.ToString() });
    }

    [HttpGet("payroll/periods/{id:guid}/payslips")]
    public async Task<IActionResult> PeriodPayslips(Guid id, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        var rows = await _db.Payslips.AsNoTracking().Where(s => s.PeriodId == id).OrderBy(s => s.EmployeeId).ToListAsync(ct);
        await AuditAsync("Payslip", id.ToString(), "SensitiveViewed", new { field = "payrollList", count = rows.Count }, rows.FirstOrDefault()?.TenantSlug);
        return Ok(rows);
    }

    // ------------------------------------------------------------------ pusula

    /// <summary>Çalışanın kendi pusulaları: yalnızca kapanmış dönemler.</summary>
    [HttpGet("payslips/me")]
    public async Task<IActionResult> MyPayslips(CancellationToken ct)
    {
        var me = await MyEmployeeIdAsync(ct);
        if (me is null) return Ok(Array.Empty<object>());
        var closed = _db.PayrollPeriods.Where(p => p.Status == PayrollPeriodStatus.Closed).Select(p => p.Id);
        return Ok(await _db.Payslips.AsNoTracking().Where(s => s.EmployeeId == me && closed.Contains(s.PeriodId))
            .OrderByDescending(s => s.Year).ThenByDescending(s => s.Month).ToListAsync(ct));
    }

    [HttpGet("payslips/{id:guid}")]
    public async Task<IActionResult> GetPayslip(Guid id, CancellationToken ct)
    {
        var s = await _db.Payslips.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (s is null) return NotFound();
        var me = await MyEmployeeIdAsync(ct);
        if (me == s.EmployeeId)
        {
            var closed = await _db.PayrollPeriods.AnyAsync(p => p.Id == s.PeriodId && p.Status == PayrollPeriodStatus.Closed, ct);
            if (!closed && !IsPayrollViewer) return NotFound();
        }
        else
        {
            if (!IsPayrollViewer) return NotFound();
            await AuditAsync("Payslip", s.EmployeeId.ToString(), "SensitiveViewed", new { field = "payslip", s.Year, s.Month }, s.TenantSlug);
        }
        var p = await ParamsAsync(s.Year, ct);
        return Ok(new { payslip = s, rates = new { p.SgkEmployeeRate, p.UnemploymentEmployeeRate, p.StampTaxRate, employerSgkRate = p.EffectiveEmployerSgkRate, p.UnemploymentEmployerRate } });
    }
}

/// <summary>Bordro denetim günlüğü kategorisi (ILogger için).</summary>
public sealed class PayrollAudit { }
