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
    private readonly PayrollAnomalyClient? _anomaly;
    public PayrollController(CompensationDbContext db, ITenantContext tenant, PayrollAnomalyClient? anomaly = null)
    {
        _db = db; _tenant = tenant; _anomaly = anomaly;
    }

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

    // ------------------------------------------------------------------ parametreler (madde 60)

    /// <summary>Dönem ayına göre geçerli parametreler (yıl içinde birden fazla yürürlük satırı olabilir).</summary>
    private async Task<PayrollParams> ParamsAsync(int year, int month, CancellationToken ct)
    {
        var rows = await _db.PayrollParameters.AsNoTracking().Where(p => p.Year == year).ToListAsync(ct);
        return PayrollParameterResolver.Resolve(rows, year, month);
    }

    private static object RowView(PayrollParameterSet r) => new
    {
        r.Id, r.Year, r.ValidFromMonth, r.MinimumWageGross, r.MinimumWageNet, r.SgkEmployeeRate, r.UnemploymentEmployeeRate,
        r.SgkEmployerRate, r.EmployerIncentivePoints, r.UnemploymentEmployerRate, r.StampTaxRate, r.SgkCeilingMultiplier,
        brackets = JsonSerializer.Deserialize<List<TaxBracket>>(r.BracketsJson, Json), r.MinimumWageExemption, r.AgiMonthly,
        r.SeveranceCeilingH1, r.SeveranceCeilingH2, r.Verified, r.Source, r.UpdatedBy, r.UpdatedAt,
    };

    /// <summary>
    /// Yılın parametreleri: istenen ay (varsayılan Ocak) için geçerli değerler üst düzeyde, yılın tüm yürürlük
    /// satırları "rows"ta. Satır yoksa koddaki yasal varsayılanlar döner (isCustom=false).
    /// </summary>
    [HttpGet("payroll/parameters/{year:int}")]
    public async Task<IActionResult> GetParameters(int year, [FromQuery] int? month, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        if (year is < 2020 or > 2100) return BadRequest(new { message = "Geçersiz yıl" });
        var m = Math.Clamp(month ?? 1, 1, 12);
        var rows = await _db.PayrollParameters.AsNoTracking().Where(p => p.Year == year).OrderBy(p => p.ValidFromMonth).ToListAsync(ct);
        var p = PayrollParameterResolver.Resolve(rows, year, m);
        var row = PayrollParameterResolver.RowFor(rows, year, m);
        return Ok(new
        {
            p.Year, month = m, validFromMonth = row?.ValidFromMonth ?? 1, p.MinimumWageGross, minimumWageNet = row?.MinimumWageNet,
            p.SgkEmployeeRate, p.UnemploymentEmployeeRate, p.SgkEmployerRate, p.EmployerIncentivePoints,
            effectiveEmployerSgkRate = p.EffectiveEmployerSgkRate, p.UnemploymentEmployerRate, p.StampTaxRate, p.SgkCeilingMultiplier,
            sgkCeiling = Math.Round(p.MinimumWageGross * p.SgkCeilingMultiplier, 2), p.OvertimeMultiplier, p.MonthlyHours,
            brackets = p.Brackets, p.MinimumWageExemption, agiMonthly = row?.AgiMonthly,
            severanceCeilingH1 = row?.SeveranceCeilingH1, severanceCeilingH2 = row?.SeveranceCeilingH2,
            verified = row?.Verified ?? year <= 2025, source = row?.Source, updatedBy = row?.UpdatedBy, updatedAt = row?.UpdatedAt,
            isCustom = row is not null, rows = rows.Select(RowView),
        });
    }

    public record ParametersInput(decimal MinimumWageGross, decimal SgkEmployerRate, decimal EmployerIncentivePoints,
        decimal StampTaxRate, decimal SgkCeilingMultiplier, List<TaxBracket> Brackets,
        int? ValidFromMonth = null, decimal? MinimumWageNet = null, decimal? SgkEmployeeRate = null, decimal? UnemploymentEmployeeRate = null,
        decimal? UnemploymentEmployerRate = null, bool? MinimumWageExemption = null, decimal? AgiMonthly = null,
        decimal? SeveranceCeilingH1 = null, decimal? SeveranceCeilingH2 = null, bool? Verified = null, string? Source = null);

    /// <summary>
    /// Yıl + yürürlük ayı satırını yazar (bordro yetkilisi). Eski ve yeni değerler denetim kaydına yazılır.
    /// Kapanmış dönemler etkilenmez (pusulalar saklıdır); açık dönemler yeniden hesaplanınca yeni değer girer.
    /// </summary>
    [HttpPut("payroll/parameters/{year:int}")]
    public async Task<IActionResult> PutParameters(int year, [FromBody] ParametersInput body, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var from = body.ValidFromMonth ?? 1;
        var d = PayrollDefaults.For(year);
        var sgkEmp = body.SgkEmployeeRate ?? d.SgkEmployeeRate;
        var unEmp = body.UnemploymentEmployeeRate ?? d.UnemploymentEmployeeRate;
        var unEr = body.UnemploymentEmployerRate ?? d.UnemploymentEmployerRate;
        var err = PayrollParameterResolver.Validate(year, from, body.MinimumWageGross, sgkEmp, unEmp, body.SgkEmployerRate, body.EmployerIncentivePoints,
            unEr, body.StampTaxRate, body.SgkCeilingMultiplier, body.Brackets, body.SeveranceCeilingH1, body.SeveranceCeilingH2);
        if (err is not null) return BadRequest(new { message = err });
        if (body.Source is { Length: > 300 }) return BadRequest(new { message = "Kaynak notu en fazla 300 karakter olabilir" });
        var row = await _db.PayrollParameters.FirstOrDefaultAsync(p => p.Year == year && p.ValidFromMonth == from, ct);
        var before = row is null ? null : RowView(row);
        if (row is null) { row = new PayrollParameterSet { Year = year, ValidFromMonth = from }; _db.PayrollParameters.Add(row); }
        row.MinimumWageGross = body.MinimumWageGross; row.SgkEmployerRate = body.SgkEmployerRate;
        row.EmployerIncentivePoints = body.EmployerIncentivePoints; row.StampTaxRate = body.StampTaxRate;
        row.SgkCeilingMultiplier = body.SgkCeilingMultiplier; row.BracketsJson = JsonSerializer.Serialize(body.Brackets, Json);
        row.SgkEmployeeRate = sgkEmp; row.UnemploymentEmployeeRate = unEmp; row.UnemploymentEmployerRate = unEr;
        row.MinimumWageNet = body.MinimumWageNet; row.MinimumWageExemption = body.MinimumWageExemption ?? true; row.AgiMonthly = body.AgiMonthly;
        row.SeveranceCeilingH1 = body.SeveranceCeilingH1; row.SeveranceCeilingH2 = body.SeveranceCeilingH2;
        // Elle girilen değer, kullanıcı aksini belirtmedikçe "doğrulandı" sayılır (kaynağı yazması istenir).
        row.Verified = body.Verified ?? true; row.Source = string.IsNullOrWhiteSpace(body.Source) ? row.Source : body.Source.Trim();
        row.UpdatedBy = UserName ?? UserId; row.UpdatedAt = DateTimeOffset.UtcNow;
        await _db.SaveChangesAsync(ct);
        await AuditAsync("PayrollParameterSet", $"{year}-{from:00}", before is null ? "Created" : "Updated", new { before, after = RowView(row) }, row.TenantSlug);
        return await GetParameters(year, from, ct);
    }

    /// <summary>Yürürlük satırını siler (validFromMonth verilmezse yılın tüm satırları): yasal varsayılanlara dönülür.</summary>
    [HttpDelete("payroll/parameters/{year:int}")]
    public async Task<IActionResult> ResetParameters(int year, [FromQuery] int? validFromMonth, CancellationToken ct)
    {
        if (!IsPayrollAdmin) return Forbid();
        var rows = await _db.PayrollParameters.Where(p => p.Year == year && (validFromMonth == null || p.ValidFromMonth == validFromMonth)).ToListAsync(ct);
        if (rows.Count > 0)
        {
            _db.PayrollParameters.RemoveRange(rows);
            await _db.SaveChangesAsync(ct);
            await AuditAsync("PayrollParameterSet", year.ToString(), "Deleted", new { before = rows.Select(RowView) }, rows[0].TenantSlug);
        }
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
        var p = await ParamsAsync(body.Year, body.Month, ct);
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
        await _db.RetroDiffs.Where(r => r.TargetPeriodId == id && r.Status == "Approved").ExecuteUpdateAsync(u => u.SetProperty(r => r.Status, "Cancelled"), ct);
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
        // Fark bordrosu kalemi silinirse fark kaydı iptal olur (yeniden önerilebilir).
        if (a.SourceId is { } src)
            foreach (var rd in await _db.RetroDiffs.Where(r => r.Id == src && r.Status == "Approved").ToListAsync(ct)) rd.Status = "Cancelled";
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
        var p = await ParamsAsync(period.Year, period.Month, ct);
        // Madde 58: eksik gün sayılan izin türleri şirketin eşlemesinden (varsayılan yalnızca ücretsiz izin — önceki davranış).
        var settings = PayrollSettingsModel.From(await _db.PayrollSettings.AsNoTracking().FirstOrDefaultAsync(ct));
        var reducing = settings.Sgk.PayReducingLeaveTypes().ToArray();

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

        // Eksik gün: onaylı, ücretten düşen türdeki izinlerin (varsayılan: ücretsiz izin) bu aya düşen takvim günleri.
        // Dalga 9 (madde 70): tek günlük kısmi izin (yarım gün / saatlik, "Days" < 1) eksik gün SAYILMAZ — SGK'da
        // eksik gün tam gün üzerinden bildirilir; kısmi ücretsiz iznin ücret kesintisi gerekiyorsa dönemin
        // kesintisi olarak elle girilir.
        var unpaid = await _db.Database.SqlQueryRaw<EmpNumber>("""
            SELECT "EmployeeId", sum(least("EndDate", {2}) - greatest("StartDate", {1}) + 1)::numeric AS "Value"
            FROM leave_requests
            WHERE "TenantSlug" = {0} AND "Type" = ANY({3}) AND "Status" = 'Approved' AND "StartDate" <= {2} AND "EndDate" >= {1}
              AND NOT ("StartDate" = "EndDate" AND "Days" < 1)
            GROUP BY "EmployeeId"
            """, tenant, start, end, reducing).ToListAsync(ct);
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

        // Bordro denetimi (ML dalgası 2): olağan dışı fazla mesai / ek ödeme / kesinti / brüt işaretleri.
        // Hesaplama sonucu bu çağrıya BAĞLI DEĞİLDİR: ML yanıt vermezse (6 sn) işaret yazılmaz, dönem yine "Hesaplandı".
        var (anomalyChecked, anomalyFlags) = await RunAnomalyCheckAsync(period, current, ct);
        // Madde 72: puantaj dönemi kapatılmadıysa fazla mesai sonradan değişebilir; hesaplama engellenmez, uyarılır.
        var timesheetLocked = await TimesheetLockedAsync(tenant, period.Year, period.Month, ct);
        return Ok(new { period.Id, status = period.Status.ToString(), employeeCount = current.Count, anomalyChecked, anomalyFlags, timesheetLocked });
    }

    /// <summary>timeshift-service puantaj dönemi kilidi (salt okunur, aynı veritabanı). Tablo yoksa null.</summary>
    private async Task<bool?> TimesheetLockedAsync(string tenant, int year, int month, CancellationToken ct)
    {
        try
        {
            return await _db.Database.SqlQueryRaw<bool>("""
                SELECT EXISTS (SELECT 1 FROM timeshift_timesheet_periods WHERE "TenantSlug" = {0} AND "Year" = {1} AND "Month" = {2}
                               AND "Status" = 'Closed') AS "Value"
                """, tenant, year, month).FirstAsync(ct);
        }
        catch (Exception ex) when (ex is Npgsql.PostgresException or InvalidOperationException) { return null; }
    }

    private async Task<(bool Checked, int Flags)> RunAnomalyCheckAsync(PayrollPeriod period, List<CompensationRecord> current, CancellationToken ct)
    {
        if (_anomaly is null) return (false, 0);
        try
        {
            var slips = await _db.Payslips.Where(s => s.PeriodId == period.Id).OrderBy(s => s.EmployeeId).ToListAsync(ct);
            if (slips.Count == 0) return (true, 0);
            var empIds = slips.Select(s => s.EmployeeId).ToList();
            var from = period.Year * 12 + period.Month - PayrollAnomalyClient.HistoryMonths;
            var history = await _db.Payslips.AsNoTracking()
                .Where(s => s.PeriodId != period.Id && empIds.Contains(s.EmployeeId) && s.Year * 12 + s.Month >= from
                            && s.Year * 12 + s.Month < period.Year * 12 + period.Month)
                .Select(s => new PayslipHistoryRow(s.EmployeeId, s.Year, s.Month, s.OvertimeHours, s.Additions, s.Deductions, s.Gross, s.UnpaidDays))
                .ToListAsync(ct);
            var grades = current.GroupBy(r => r.EmployeeId).ToDictionary(g => g.Key, g => g.First().Grade);
            var (ok, n) = await _anomaly.CheckAsync(_tenant.TenantSlug ?? period.TenantSlug, period.Year, period.Month, slips, grades, history,
                Request.Headers.Authorization.ToString(), ct);
            if (ok) period.AnomalyCheckedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync(ct);
            return (ok, n);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            HttpContext.RequestServices.GetService<ILogger<PayrollAudit>>()?.LogWarning(ex, "Bordro denetimi yapılamadı");
            return (false, 0);
        }
    }

    /// <summary>
    /// Bordro denetim işaretleri (yalnızca bordro yetkilisi; çalışan kendi pusulasında görmez). Kapatmadan
    /// önce hazırlayan ve onaylayanın incelemesi içindir; otomatik düzeltme ya da engelleme yoktur.
    /// Görüntüleme hassas veri erişim kaydına yazılır.
    /// </summary>
    [HttpGet("payroll/periods/{id:guid}/anomalies")]
    public async Task<IActionResult> Anomalies(Guid id, CancellationToken ct)
    {
        if (!IsPayrollViewer) return Forbid();
        var period = await _db.PayrollPeriods.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (period is null) return NotFound(new { message = "Dönem bulunamadı" });
        var rows = await _db.Payslips.AsNoTracking().Where(s => s.PeriodId == id && s.AnomalyFlagsJson != null)
            .Select(s => new { s.Id, s.EmployeeId, s.AnomalyFlagsJson }).ToListAsync(ct);
        var items = rows.Select(r =>
        {
            using var doc = JsonDocument.Parse(r.AnomalyFlagsJson!);
            return new { payslipId = r.Id, employeeId = r.EmployeeId, flags = doc.RootElement.Clone() };
        }).ToList();
        if (items.Count > 0)
            await AuditAsync("Payslip", id.ToString(), "SensitiveViewed", new { field = "payrollAnomalies", count = items.Count }, period.TenantSlug);
        return Ok(new { periodId = id, checkedAt = period.AnomalyCheckedAt, calculatedAt = period.CalculatedAt, items });
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
            // Otomatik avans taksitlerinde CreatedBy boştur; elle girilen ve fark bordrosu (onaylayan) kalemleri sayılır.
            .Where(a => a.PeriodId == period.Id && a.CreatedBy != null)
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
        var p = await ParamsAsync(s.Year, s.Month, ct);
        return Ok(new { payslip = s, rates = new { p.SgkEmployeeRate, p.UnemploymentEmployeeRate, p.StampTaxRate, employerSgkRate = p.EffectiveEmployerSgkRate, p.UnemploymentEmployerRate } });
    }
}

/// <summary>Bordro denetim günlüğü kategorisi (ILogger için).</summary>
public sealed class PayrollAudit { }
