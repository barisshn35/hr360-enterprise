using Microsoft.EntityFrameworkCore;
using TimeShiftService.Data;

namespace TimeShiftService.Services;

/// <summary>
/// Dalga 5c yardımcıları: çalışan adları/departman başı (paylaşılan veritabanından salt okunur),
/// uygulama içi bildirim satırı. Her sorgu kiracı slug'ıyla filtrelenir.
/// </summary>
public static class TsOps
{
    public sealed class PersonRow
    {
        public Guid Id { get; set; }
        public string FirstName { get; set; } = "";
        public string LastName { get; set; } = "";
        public Guid? DepartmentId { get; set; }
        public string? Department { get; set; }
        public Guid? HeadId { get; set; }
        public string Status { get; set; } = "";
        public string FullName => $"{FirstName} {LastName}".Trim();
    }

    private const string PeopleSql = """
        SELECT e."Id", e."FirstName", e."LastName", a."DepartmentId", d."Name" AS "Department", d."HeadEmployeeId" AS "HeadId", e."Status"
        FROM employee_employees e
        LEFT JOIN LATERAL (SELECT x."DepartmentId" FROM employee_assignments x WHERE x."EmployeeId" = e."Id"
                           AND x."EffectiveFrom" <= current_date AND (x."EffectiveTo" IS NULL OR x."EffectiveTo" >= current_date)
                           ORDER BY x."EffectiveFrom" DESC LIMIT 1) a ON true
        LEFT JOIN organization_departments d ON d."Id" = a."DepartmentId"
        WHERE e."TenantSlug" = {0}
        """;

    public static Task<List<PersonRow>> PeopleAsync(TimeShiftDbContext db, string tenant, CancellationToken ct) =>
        db.Database.SqlQueryRaw<PersonRow>(PeopleSql, tenant).ToListAsync(ct);

    public static Task<PersonRow?> PersonAsync(TimeShiftDbContext db, string tenant, Guid id, CancellationToken ct) =>
        db.Database.SqlQueryRaw<PersonRow>(PeopleSql + " AND e.\"Id\" = {1}", tenant, id).FirstOrDefaultAsync(ct);

    public static async Task NotifyAsync(TimeShiftDbContext db, string tenant, Guid recipient, string subject, string body, string code, CancellationToken ct)
    {
        try
        {
            await db.Database.ExecuteSqlRawAsync("""
                INSERT INTO notification_messages ("Id","TenantSlug","RecipientEmployeeId","RecipientEmail","Channel","TemplateCode","Subject","Body","Status","AttemptCount","CreatedAt")
                VALUES ({0},{1},{2},NULL,'InApp',{3},{4},{5},'Pending',0,now())
                """, new object[] { Guid.NewGuid(), tenant, recipient, code, subject, body }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException) { /* bildirim yazılamazsa iş akışı bozulmaz */ }
    }
}
