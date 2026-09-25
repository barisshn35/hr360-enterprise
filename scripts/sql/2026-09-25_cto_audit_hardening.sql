-- CTO denetimi (2026-09-25) - mevcut veritabanlari icin sema degisiklikleri.
-- Yeni kurulumlar data/migrations/sql-all-schemas.sql'den ayni semayi alir.
-- Idempotent: tekrar calistirilabilir.
--
-- Calistirma: psql -d hr360_operational -f scripts/sql/2026-09-25_cto_audit_hardening.sql

BEGIN;

-- 1) Masraf beyani: gorev ayriligi icin onaylayan kisi (onaylayan "odendi" isaretleyemez).
ALTER TABLE expense_claims ADD COLUMN IF NOT EXISTS "ApprovedByEmployeeId" uuid;

COMMIT;
