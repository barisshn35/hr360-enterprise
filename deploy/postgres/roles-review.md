# Veritabanı rolleri — elle gözden geçirme listesi

OTOMATİK ÜRETİLDİ: `scripts/db-roles.sh generate`. Eşleme kod taramasıyla çıkarılır; aşağıdakiler
taramanın kesin karar veremediği ya da bilinçli bir tercih gerektiren noktalardır.

## Genel

- Yeni migration (yeni tablo) sonrasında `scripts/db-roles.sh generate && scripts/db-roles.sh grants`
  çalıştırılmalı. `hr360admin` için `ALTER DEFAULT PRIVILEGES` bilerek açılmadı (en az yetki).
- `audit_log`: servis rolleri yalnızca SELECT + INSERT (zincir tetikleyicisi önceki satırı okur).
  UPDATE zaten tetikleyiciyle (`audit_log_immutable`) engelli. Saklama süresi silmesi
  (governance `Retention`, kategori AuditLog) `hr360_retention` rolü ister.
- `messaging_outbox`, `messaging_processed_events` tüm servislerce paylaşılır (tam yetki):
  bir servis rolü başka servisin outbox satırını değiştirebilir. Ayırmak için tablo bölünmeli.
- Fonksiyonlar (`hr360_fold`, `audit_row_hash`, tetikleyici fonksiyonları) PUBLIC EXECUTE ile çalışır.
- Görünümler (`analytics_department_headcount`, `analytics_hires_monthly`, `analytics_leave_monthly`, `analytics_overtime_monthly`) sahibinin (hr360admin) yetkisiyle çalışır; RLS'yi atlar.
- Yalnızca tablo adının bir metin sabitinde geçmesi SELECT verir (yorumlar hariç). Bu, sütun adı/ileti
  gibi yanlış pozitiflerle fazladan SELECT verebilir; yazma yetkileri yalnızca SQL kalıplarından gelir.
- EF ile eşlenmiş tablolarda (ToTable) tam yetki verilir: SaveChanges'in yazıp yazmadığı statik
  olarak ayırt edilemez.
- employee-service ve organization-service açılışta `EnsureCreated()` çağırır: rol tablolarını
  gördüğü sürece (information_schema yetkili tabloları gösterir) işlem yapmaz; rolün hiç tablosu
  görünmezse CREATE TABLE dener ve şema CREATE yetkisi olmadığı için açılış hata verir.
- Python ML servisi, Keycloak, MLflow ve postgres-exporter `hr360admin` ile kalır (kapsam dışı).

## Servis özeti

| Servis | Rol | Toplam tablo | Kendi | Başka servisten salt okuma | Başka servise yazma |
|---|---|---|---|---|---|
| organization-service | `hr360_organization` | 9 | 5 | 3 | 0 |
| employee-service | `hr360_employee` | 6 | 2 | 2 | 0 |
| workflow-service | `hr360_workflow` | 14 | 5 | 7 | 0 |
| leave-service | `hr360_leave` | 12 | 3 | 6 | 0 |
| recruitment-service | `hr360_recruitment` | 16 | 8 | 4 | 2 |
| onboarding-service | `hr360_onboarding` | 15 | 8 | 5 | 1 |
| timeshift-service | `hr360_timeshift` | 23 | 15 | 5 | 1 |
| performance-service | `hr360_performance` | 17 | 11 | 5 | 0 |
| learning-service | `hr360_learning` | 22 | 15 | 5 | 1 |
| engagement-service | `hr360_engagement` | 34 | 14 | 18 | 1 |
| governance-service | `hr360_governance` | 118 | 66 | 44 | 7 |
| compensation-service | `hr360_compensation` | 24 | 13 | 9 | 1 |
| expense-service | `hr360_expense` | 20 | 9 | 5 | 3 |
| notification-service | `hr360_notification` | 10 | 6 | 2 | 0 |
| tenant-service | `hr360_tenant` | 13 | 9 | 2 | 1 |

## recruitment-service (`hr360_recruitment`)

- Başka servisin tablosuna yazma: `governance_destruction_logs` (INSERT) — apps/services/recruitment-service/Services/RecruitmentSql.cs:138
- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/recruitment-service/Services/RecruitmentSql.cs:81; apps/services/recruitment-service/Services/RecruitmentSql.cs:98

## onboarding-service (`hr360_onboarding`)

- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/onboarding-service/Services/OnboardingJobsWorker.cs:58; apps/services/onboarding-service/Services/Ops.cs:84

## timeshift-service (`hr360_timeshift`)

- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/timeshift-service/Services/TsOps.cs:44
- apps/services/timeshift-service/Controllers/ShiftSwapsController.cs:282: satır kilidi (FOR UPDATE/SHARE) — metindeki tüm tablolara UPDATE verildi: timeshift_assignments

## learning-service (`hr360_learning`)

- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/learning-service/Services/CertificateReminderWorker.cs:130; apps/services/learning-service/Services/LearningDirectory.cs:129

## engagement-service (`hr360_engagement`)

- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/engagement-service/Infrastructure/Platform.cs:157
- apps/services/engagement-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/engagement-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)

## governance-service (`hr360_governance`)

- Başka servisin tablosuna yazma: `compensation_payslips` (DELETE) — apps/services/governance-service/Infrastructure/Events.cs:583
- Başka servisin tablosuna yazma: `employee_employees` (UPDATE) — apps/services/governance-service/Infrastructure/Events.cs:630
- Başka servisin tablosuna yazma: `engagement_kudos` (UPDATE) — apps/services/governance-service/Infrastructure/Events.cs:640
- Başka servisin tablosuna yazma: `engagement_profiles` (UPDATE) — apps/services/governance-service/Infrastructure/Events.cs:635
- Başka servisin tablosuna yazma: `notification_messages` (DELETE, INSERT) — apps/services/governance-service/Infrastructure/Events.cs:575
- Başka servisin tablosuna yazma: `notification_preferences` (INSERT, UPDATE) — apps/services/governance-service/Controllers/LanguagePreferenceController.cs:42
- Başka servisin tablosuna yazma: `recruitment_candidates` (DELETE, UPDATE) — apps/services/governance-service/Infrastructure/Events.cs:562
- apps/services/governance-service/Controllers/ComplianceControllers.cs:188: tablo adı çalışma anında birleştiriliyor (`SELECT * FROM {table} WHERE \"TenantSlug\" = $1 AND {where}{(orderBy is null ? "" : " ORDE`)
- apps/services/governance-service/Infrastructure/NlReport.cs:459: tablo adı çalışma anında birleştiriliyor (`SELECT coalesce(d.\"Name\", '{unassigned}'), {valueExpr}, {distinctPeople} FROM {from} {De`)
- apps/services/governance-service/Infrastructure/NlReport.cs:460: tablo adı çalışma anında birleştiriliyor (`SELECT date_trunc('month', {dateExpr})::date, {valueExpr}, {distinctPeople} FROM {from} {D`)
- apps/services/governance-service/Infrastructure/NlReport.cs:461: tablo adı çalışma anında birleştiriliyor (`SELECT {typeExpr}, {valueExpr}, {distinctPeople} FROM {from} {DeptJoin} {where} GROUP BY 1`)
- apps/services/governance-service/Infrastructure/NlReport.cs:462: tablo adı çalışma anında birleştiriliyor (`SELECT e.\"FirstName\" || ' ' || e.\"LastName\", {valueExpr}, 1 FROM {from} {DeptJoin} {wh`)
- apps/services/governance-service/Infrastructure/NlReport.cs:463: tablo adı çalışma anında birleştiriliyor (`SELECT '{label}', {valueExpr}, {distinctPeople} FROM {from} {DeptJoin} {where}`)
- apps/services/governance-service/Infrastructure/NlReport.cs:531: tablo adı çalışma anında birleştiriliyor (`SELECT e.\"FirstName\" || ' ' || e.\"LastName\", round(avg(s.\"Score\"), 1), 1 FROM {lates`)
- apps/services/governance-service/Infrastructure/NlReport.cs:533: tablo adı çalışma anında birleştiriliyor (`SELECT coalesce(d.\"Name\", '{unassigned}'), round(avg(s.\"Score\"), 1), count(*) FROM {la`)
- apps/services/governance-service/Infrastructure/NlReport.cs:534: tablo adı çalışma anında birleştiriliyor (`SELECT '{L("Ortalama puan", "Average score")}', round(avg(s.\"Score\"), 1), count(*) FROM `)
- apps/services/governance-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/governance-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)
- Not: audit_log: DELETE VERİLMEDİ (değiştirilemez denetim kaydı; silme hr360_retention'da)
- Not: governance_document_requests üzerindeki DELETE tetikleyicisi governance_signature_otps için DELETE istiyor
- Not: governance_document_requests üzerindeki DELETE tetikleyicisi governance_signatures için DELETE istiyor

## compensation-service (`hr360_compensation`)

- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/compensation-service/Controllers/PayrollEcosystemController.cs:65
- apps/services/compensation-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/compensation-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)

## expense-service (`hr360_expense`)

- Başka servisin tablosuna yazma: `governance_signature_otps` (DELETE) — tetikleyici: expense_documents DELETE
- Başka servisin tablosuna yazma: `governance_signatures` (DELETE) — tetikleyici: expense_documents DELETE
- Başka servisin tablosuna yazma: `notification_messages` (INSERT) — apps/services/expense-service/Controllers/DocumentSignaturesController.cs:88
- apps/services/expense-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/expense-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)
- Not: expense_documents üzerindeki DELETE tetikleyicisi governance_signature_otps için DELETE, SELECT istiyor
- Not: expense_documents üzerindeki DELETE tetikleyicisi governance_signatures için DELETE, SELECT istiyor

## notification-service (`hr360_notification`)

- apps/services/notification-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/notification-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)

## tenant-service (`hr360_tenant`)

- Başka servisin tablosuna yazma: `organization_companies` (DELETE, INSERT) — apps/services/tenant-service/Services/TenantProvisioningService.cs:154
- apps/services/tenant-service/Security/KeyRotationJob.cs:107: tablo adı çalışma anında birleştiriliyor (`UPDATE {c.Table} SET {col} = @new WHERE {id} = @id AND {col} = @old`)
- apps/services/tenant-service/Security/KeyRotationJob.cs:92: tablo adı çalışma anında birleştiriliyor (`SELECT {id}, {col} FROM {c.Table} WHERE {col} IS NOT NULL{filter}{(last is null ? "" : $" `)

## Hiçbir servisin kodunda geçmeyen tablolar

Bu tablolara hiçbir rol yetki almadı (ölü tablo, yalnızca betik/ML kullanımı ya da dinamik ad olabilir):

- `analytics_hires_monthly`
