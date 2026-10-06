-- Bordro dalgası 8 (madde 58–65): Türkiye bordrosu — yıllık/yarıyıllık bordro parametreleri, SGK APHB
-- alanları (meslek kodu, belge türü, kanun, SGDP), bordro ayarları (eksik gün kodları, banka şablonu,
-- hesap planı), fark bordrosu, kıdem/ihbar hesabı, e-bordro teslim/okundu kaydı, ücret bandı yürürlük
-- tarihi ve dışa aktarım dosya özeti. İdempotent; canlı veriyi değiştirmez (yalnızca eksik parametre
-- satırlarını tohumlar, mevcut şirket parametrelerine dokunmaz).
-- Canlıya: docker exec -i hr360-postgres-1 psql -v ON_ERROR_STOP=1 -q -U hr360admin -d hr360_operational < bu_dosya

-- ---------------------------------------------------------------- 60) bordro parametreleri
-- Yıl içinde değişiklik (ör. Temmuz'da asgari ücret artışı) için "ValidFromMonth" (1 = yıl başı, 7 = Temmuz).
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "ValidFromMonth" integer NOT NULL DEFAULT 1;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "SgkEmployeeRate" numeric NOT NULL DEFAULT 0.14;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "UnemploymentEmployeeRate" numeric NOT NULL DEFAULT 0.01;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "UnemploymentEmployerRate" numeric NOT NULL DEFAULT 0.02;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "MinimumWageNet" numeric;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "MinimumWageExemption" boolean NOT NULL DEFAULT true;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "AgiMonthly" numeric;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "SeveranceCeilingH1" numeric;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "SeveranceCeilingH2" numeric;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "Verified" boolean NOT NULL DEFAULT true;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "Source" text;
ALTER TABLE compensation_payroll_parameters ADD COLUMN IF NOT EXISTS "UpdatedBy" text;
DROP INDEX IF EXISTS "IX_compensation_payroll_parameters_TenantSlug_Year";
CREATE UNIQUE INDEX IF NOT EXISTS "IX_compensation_payroll_parameters_TenantSlug_Year_From"
    ON compensation_payroll_parameters ("TenantSlug", "Year", "ValidFromMonth");

-- Tohum: o yıl için hiç satırı olmayan şirketlere 2025 (doğrulandı) ve 2026 (DOĞRULANMADI) yasal değerleri.
-- Değerler koddaki varsayılanlarla (PayrollDefaults) birebir aynıdır; hesaplama sonucu değişmez.
INSERT INTO compensation_payroll_parameters ("Id","TenantSlug","Year","ValidFromMonth","MinimumWageGross","MinimumWageNet",
    "SgkEmployeeRate","UnemploymentEmployeeRate","SgkEmployerRate","EmployerIncentivePoints","UnemploymentEmployerRate",
    "StampTaxRate","SgkCeilingMultiplier","BracketsJson","MinimumWageExemption","SeveranceCeilingH1","SeveranceCeilingH2",
    "Verified","Source","UpdatedBy","UpdatedAt")
SELECT gen_random_uuid(), t."Slug", 2025, 1, 26005.50, 22104.67, 0.14, 0.01, 0.2075, 5, 0.02, 0.00759, 7.5,
       '[{"upTo":158000,"rate":0.15},{"upTo":330000,"rate":0.20},{"upTo":1200000,"rate":0.27},{"upTo":4300000,"rate":0.35},{"upTo":null,"rate":0.40}]',
       true, 46655.43, 53919.68, true, 'Resmî Gazete 2025 asgari ücret, GVK m.103 (2025 tarifesi), kıdem tavanı 2025/1-2', 'tohum', now()
FROM platform_tenants t
WHERE NOT EXISTS (SELECT 1 FROM compensation_payroll_parameters p WHERE p."TenantSlug" = t."Slug" AND p."Year" = 2025);

INSERT INTO compensation_payroll_parameters ("Id","TenantSlug","Year","ValidFromMonth","MinimumWageGross","MinimumWageNet",
    "SgkEmployeeRate","UnemploymentEmployeeRate","SgkEmployerRate","EmployerIncentivePoints","UnemploymentEmployerRate",
    "StampTaxRate","SgkCeilingMultiplier","BracketsJson","MinimumWageExemption","SeveranceCeilingH1","SeveranceCeilingH2",
    "Verified","Source","UpdatedBy","UpdatedAt")
SELECT gen_random_uuid(), t."Slug", 2026, 1, 33030.00, 28075.50, 0.14, 0.01, 0.2175, 2, 0.02, 0.00759, 9,
       '[{"upTo":190000,"rate":0.15},{"upTo":400000,"rate":0.20},{"upTo":1500000,"rate":0.27},{"upTo":5300000,"rate":0.35},{"upTo":null,"rate":0.40}]',
       true, 64948.77, 73729.87, false, 'Uygulamadaki 2026 varsayılanları — resmî kaynakla doğrulayın', 'tohum', now()
FROM platform_tenants t
WHERE NOT EXISTS (SELECT 1 FROM compensation_payroll_parameters p WHERE p."TenantSlug" = t."Slug" AND p."Year" = 2026);

-- ---------------------------------------------------------------- 58/62/64) bordro ayarları (şirket başına tek satır)
CREATE TABLE IF NOT EXISTS compensation_payroll_settings (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "SgkJson" text NOT NULL DEFAULT '{}',
    "AccountMapJson" text NOT NULL DEFAULT '{}',
    "CostCentersJson" text NOT NULL DEFAULT '{}',
    "BankTemplateJson" text NOT NULL DEFAULT '{}',
    "UpdatedBy" text,
    "UpdatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_compensation_payroll_settings_TenantSlug" ON compensation_payroll_settings ("TenantSlug");

-- 58) Çalışanın SGK bildirim bilgileri: meslek kodu (ISCO-08 tabanlı SGK meslek kodu), belge türü/kanun
-- (boşsa şirket varsayılanı), SGDP (emekli çalışan). Özel nitelikli veri değildir; yalnızca bordro yetkilisi görür.
CREATE TABLE IF NOT EXISTS compensation_employee_sgk (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "OccupationCode" character varying(16),
    "DocumentType" character varying(4),
    "LawNo" character varying(8),
    "Sgdp" boolean NOT NULL DEFAULT false,
    "UpdatedBy" text,
    "UpdatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_compensation_employee_sgk_emp" ON compensation_employee_sgk ("TenantSlug", "EmployeeId");

-- 62) dışa aktarım: üretilen dosyanın SHA-256 özeti ve biçimi (denetim kaydına da yazılır).
ALTER TABLE compensation_payroll_exports ADD COLUMN IF NOT EXISTS "ContentSha256" text;
ALTER TABLE compensation_payroll_exports ADD COLUMN IF NOT EXISTS "Format" text;

-- ---------------------------------------------------------------- 63) fark bordrosu
CREATE TABLE IF NOT EXISTS compensation_retro_diffs (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "SourcePeriodId" uuid NOT NULL,
    "SourceYear" integer NOT NULL,
    "SourceMonth" integer NOT NULL,
    "OldBase" numeric(18,2) NOT NULL,
    "NewBase" numeric(18,2) NOT NULL,
    "OldGross" numeric(18,2) NOT NULL,
    "NewGross" numeric(18,2) NOT NULL,
    "DiffGross" numeric(18,2) NOT NULL,
    "Status" text NOT NULL DEFAULT 'Approved',
    "TargetPeriodId" uuid NOT NULL,
    "AdjustmentId" uuid,
    "CreatedBy" text NOT NULL DEFAULT '',
    "CreatedByName" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IX_compensation_retro_diffs_emp" ON compensation_retro_diffs ("TenantSlug", "EmployeeId", "SourcePeriodId");
CREATE INDEX IF NOT EXISTS "IX_compensation_retro_diffs_target" ON compensation_retro_diffs ("TenantSlug", "TargetPeriodId");

-- ---------------------------------------------------------------- 61) kıdem ve ihbar
CREATE TABLE IF NOT EXISTS compensation_severance_calcs (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "OffboardingCaseId" uuid,
    "HireDate" date NOT NULL,
    "LastWorkingDay" date NOT NULL,
    "Reason" text NOT NULL,
    "InputJson" text NOT NULL DEFAULT '{}',
    "ResultJson" text NOT NULL DEFAULT '{}',
    "TotalNet" numeric(18,2) NOT NULL DEFAULT 0,
    "Status" text NOT NULL DEFAULT 'Draft',
    "PreparedBy" text NOT NULL DEFAULT '',
    "PreparedByName" text,
    "DecidedBy" text,
    "DecidedByName" text,
    "DecisionNote" text,
    "DecidedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IX_compensation_severance_calcs_emp" ON compensation_severance_calcs ("TenantSlug", "EmployeeId");

-- ---------------------------------------------------------------- 59) e-bordro teslim ve okundu kaydı
-- "SealedCopy": teslim edilen pusulanın kanonik JSON'u, AES-256-GCM ile şifreli (TENANT_SECRET_KEYS;
-- anahtar yenilemede KeyRotationJob yeniden yazar). "ContentSha256" çalışanın onayladığı içeriğin özeti.
CREATE TABLE IF NOT EXISTS compensation_payslip_deliveries (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "PayslipId" uuid NOT NULL,
    "PeriodId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "ContentSha256" text NOT NULL,
    "SealedCopy" bytea,
    "PublishedBy" text,
    "PublishedAt" timestamptz NOT NULL DEFAULT now(),
    "EmailQueued" boolean NOT NULL DEFAULT false,
    "FirstOpenedAt" timestamptz,
    "LastOpenedAt" timestamptz,
    "OpenCount" integer NOT NULL DEFAULT 0,
    "AcknowledgedAt" timestamptz,
    "AcknowledgedSha256" text,
    "AckIpPrefix" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_compensation_payslip_deliveries_slip" ON compensation_payslip_deliveries ("TenantSlug", "PayslipId");
CREATE INDEX IF NOT EXISTS "IX_compensation_payslip_deliveries_period" ON compensation_payslip_deliveries ("TenantSlug", "PeriodId");

-- ---------------------------------------------------------------- 65) ücret bandı yürürlük tarihi
ALTER TABLE compensation_salary_bands ADD COLUMN IF NOT EXISTS "EffectiveFrom" date;

-- Yeni tablolara kiracı yalıtım politikası (RLS isteğe bağlı; açık değilse davranış değişmez).
DO $$ BEGIN
    IF to_regprocedure('hr360_rls_apply_policies()') IS NOT NULL THEN PERFORM hr360_rls_apply_policies(); END IF;
END $$;
