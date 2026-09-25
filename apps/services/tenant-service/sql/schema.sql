-- tenant-service semasi (cok kiracililik cekirdegi)
-- Kullanim (db-01'de):
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

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
