-- performance-service (Hafta 19) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE performance_cycles (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Name" text NOT NULL,
    "Year" integer NOT NULL,
    "Period" text NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date NOT NULL,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE performance_goals (
    "Id" uuid NOT NULL PRIMARY KEY,
    "CycleId" uuid NOT NULL REFERENCES performance_cycles("Id") ON DELETE CASCADE,
    "EmployeeId" uuid NOT NULL,
    "Title" text NOT NULL,
    "Description" text,
    "Weight" integer NOT NULL,
    "TargetValue" numeric,
    "CurrentValue" numeric,
    "Unit" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_performance_goals_EmployeeId" ON performance_goals ("EmployeeId");

CREATE TABLE performance_reviews (
    "Id" uuid NOT NULL PRIMARY KEY,
    "CycleId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "ReviewerEmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "OverallScore" numeric,
    "Strengths" text,
    "Improvements" text,
    "Comments" text,
    "SubmittedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_performance_reviews_Cycle_Employee"
    ON performance_reviews ("CycleId", "EmployeeId");
