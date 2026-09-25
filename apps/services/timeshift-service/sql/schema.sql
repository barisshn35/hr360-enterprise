-- timeshift-service (Hafta 18) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE timeshift_shifts (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Name" text NOT NULL,
    "StartTime" time NOT NULL,
    "EndTime" time NOT NULL,
    "BreakMinutes" integer NOT NULL,
    "DepartmentId" uuid,
    "IsNightShift" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE timeshift_assignments (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "ShiftId" uuid NOT NULL REFERENCES timeshift_shifts("Id") ON DELETE CASCADE,
    "Date" date NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_timeshift_assignments_Employee_Date"
    ON timeshift_assignments ("EmployeeId", "Date");

CREATE TABLE timeshift_time_entries (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Date" date NOT NULL,
    "ClockIn" timestamptz,
    "ClockOut" timestamptz,
    "WorkedMinutes" integer NOT NULL,
    "OvertimeMinutes" integer NOT NULL,
    "Source" text NOT NULL,
    "Note" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_timeshift_time_entries_Employee_Date"
    ON timeshift_time_entries ("EmployeeId", "Date");
