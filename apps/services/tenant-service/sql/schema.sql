-- tenant-service semasi (cok kiracililik cekirdegi)
-- Kullanim (db-01'de):
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql
--
-- NOT: bu dosya uzun sure Tenant.cs modeliyle senkron degildi (LogoUrl,
-- PrimaryColorHex, Smtp* alanlari eklenmisti ama buraya hic yansitilmamisti)
-- ve asil kullanilan data/migrations/sql-all-schemas.sql dosyasina da hic
-- eklenmemisti - platform_tenants tablosu HICBIR ZAMAN olusmuyordu
-- (hardcore test sirasinda bulundu). Asagidaki tanim guncel TenantDbContext
-- modelinden ("dotnet ef migrations script") birebir uretildi; degisiklik
-- yaptiginizda bu dosyayi VE data/migrations/sql-all-schemas.sql'i birlikte
-- guncelleyin.

CREATE TABLE IF NOT EXISTS platform_tenants (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Name" text NOT NULL,
    "Slug" text NOT NULL,
    "EmailDomain" text,
    "TaxNumber" text,
    "Status" text NOT NULL,
    "Plan" text NOT NULL,
    "KeycloakOrgId" text,
    "AdminUserId" text,
    "AdminEmail" text NOT NULL,
    "AdminFullName" text,
    "MaxEmployees" integer NOT NULL DEFAULT 25,
    "LogoUrl" text,
    "PrimaryColorHex" text,
    "SmtpHost" text,
    "SmtpPort" integer,
    "SmtpUser" text,
    "SmtpPasswordEncrypted" text,
    "SmtpFromAddress" text,
    "SmtpFromName" text,
    "CreatedAt" timestamptz NOT NULL,
    "ActivatedAt" timestamptz,
    "SuspendedAt" timestamptz,
    "SuspendReason" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "IX_platform_tenants_Slug"
    ON platform_tenants ("Slug");
CREATE INDEX IF NOT EXISTS "IX_platform_tenants_AdminEmail"
    ON platform_tenants ("AdminEmail");

CREATE TABLE IF NOT EXISTS platform_tenant_provisioning_log (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantId" uuid NOT NULL,
    "Step" text NOT NULL,
    "Success" boolean NOT NULL,
    "Detail" text,
    "OccurredAt" timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS "IX_platform_tenant_provisioning_log_TenantId"
    ON platform_tenant_provisioning_log ("TenantId");
