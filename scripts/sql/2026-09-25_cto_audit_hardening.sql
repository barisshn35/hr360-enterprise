-- CTO denetimi (2026-09-25) - mevcut veritabanlari icin sema degisiklikleri.
-- Yeni kurulumlar data/migrations/sql-all-schemas.sql'den ayni semayi alir.
-- Idempotent: tekrar calistirilabilir.
--
-- Calistirma: psql -d hr360_operational -f scripts/sql/2026-09-25_cto_audit_hardening.sql

BEGIN;

-- 1) Masraf beyani: gorev ayriligi icin onaylayan kisi (onaylayan "odendi" isaretleyemez).
ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS "ApprovedByEmployeeId" uuid;

-- 2) Deger bazli benzersiz indeksler kiraci bazli olur. Global olanlar bir kiracinin
--    baska bir kiracidaki e-postayi/etiketi "var mi" diye yoklamasina (500 = var) ve
--    ayni degeri kullanan mesru musterilerin engellenmesine yol aciyordu.
DROP INDEX IF EXISTS "IX_compensation_salary_bands_Grade_Year";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_compensation_salary_bands_TenantSlug_Grade_Year"
    ON compensation_salary_bands ("TenantSlug", "Grade", "Year");

DROP INDEX IF EXISTS "IX_employee_employees_Email";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_employee_employees_TenantSlug_Email"
    ON employee_employees ("TenantSlug", lower("Email"));

DROP INDEX IF EXISTS "IX_notification_templates_Code_Channel_Locale";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_notification_templates_TenantSlug_Code_Channel_Locale"
    ON notification_templates ("TenantSlug", "Code", "Channel", "Locale");

DROP INDEX IF EXISTS "IX_onboarding_assets_AssetTag";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_onboarding_assets_TenantSlug_AssetTag"
    ON onboarding_assets ("TenantSlug", "AssetTag");

DROP INDEX IF EXISTS "IX_recruitment_candidates_Email";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_recruitment_candidates_TenantSlug_Email"
    ON recruitment_candidates ("TenantSlug", "Email");

-- 3) Bir giris hesabi tek calisan kaydina; bir zimmetin tek acik atamasi olabilir.
CREATE UNIQUE INDEX IF NOT EXISTS "IX_employee_employees_KeycloakUserId"
    ON employee_employees ("KeycloakUserId") WHERE "KeycloakUserId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "UX_onboarding_asset_assignments_open"
    ON onboarding_asset_assignments ("AssetId") WHERE "ReturnedOn" IS NULL;

COMMIT;
