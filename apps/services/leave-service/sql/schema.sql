-- leave-service (Hafta 17) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE leave_balances (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Year" integer NOT NULL,
    "Type" text NOT NULL,
    "EntitledDays" numeric NOT NULL,
    "UsedDays" numeric NOT NULL,
    "PendingDays" numeric NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_leave_balances_Employee_Year_Type"
    ON leave_balances ("EmployeeId", "Year", "Type");

CREATE TABLE leave_requests (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date NOT NULL,
    "Days" numeric NOT NULL,
    "Reason" text,
    "Status" text NOT NULL,
    "WorkflowRequestId" uuid,
    "CreatedAt" timestamptz NOT NULL,
    "DecidedAt" timestamptz
);
CREATE INDEX "IX_leave_requests_EmployeeId" ON leave_requests ("EmployeeId");
CREATE INDEX "IX_leave_requests_Status" ON leave_requests ("Status");
