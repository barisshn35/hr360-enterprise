-- onboarding-service (Hafta 16) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE onboarding_plans (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "StartDate" date NOT NULL,
    "TemplateName" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz
);
CREATE INDEX "IX_onboarding_plans_EmployeeId" ON onboarding_plans ("EmployeeId");

CREATE TABLE onboarding_tasks (
    "Id" uuid NOT NULL PRIMARY KEY,
    "PlanId" uuid NOT NULL REFERENCES onboarding_plans("Id") ON DELETE CASCADE,
    "Title" text NOT NULL,
    "Category" text NOT NULL,
    "DueDate" date,
    "AssigneeEmployeeId" uuid,
    "Status" text NOT NULL,
    "Order" integer NOT NULL,
    "CompletedAt" timestamptz
);
CREATE INDEX "IX_onboarding_tasks_PlanId" ON onboarding_tasks ("PlanId");

CREATE TABLE onboarding_assets (
    "Id" uuid NOT NULL PRIMARY KEY,
    "AssetTag" text NOT NULL,
    "Type" text NOT NULL,
    "Model" text,
    "SerialNumber" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_onboarding_assets_AssetTag" ON onboarding_assets ("AssetTag");

CREATE TABLE onboarding_asset_assignments (
    "Id" uuid NOT NULL PRIMARY KEY,
    "AssetId" uuid NOT NULL REFERENCES onboarding_assets("Id") ON DELETE CASCADE,
    "EmployeeId" uuid NOT NULL,
    "AssignedOn" date NOT NULL,
    "ReturnedOn" date,
    "ConditionOnReturn" text,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_onboarding_asset_assignments_EmployeeId"
    ON onboarding_asset_assignments ("EmployeeId");
