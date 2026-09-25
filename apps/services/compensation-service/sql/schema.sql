-- compensation-service (Hafta 21) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE compensation_salary_bands (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Grade" text NOT NULL,
    "Title" text,
    "MinAmount" numeric NOT NULL,
    "MidAmount" numeric NOT NULL,
    "MaxAmount" numeric NOT NULL,
    "Currency" text NOT NULL,
    "Year" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_compensation_salary_bands_Grade_Year"
    ON compensation_salary_bands ("Grade", "Year");

CREATE TABLE compensation_records (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "BaseSalary" numeric NOT NULL,
    "Currency" text NOT NULL,
    "Grade" text,
    "Reason" text NOT NULL,
    "EffectiveFrom" date NOT NULL,
    "EffectiveTo" date,
    "Note" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_compensation_records_EmployeeId" ON compensation_records ("EmployeeId");
