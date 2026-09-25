-- expense-service (Hafta 22) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE expense_claims (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Title" text NOT NULL,
    "Currency" text NOT NULL,
    "TotalAmount" numeric NOT NULL,
    "Status" text NOT NULL,
    "WorkflowRequestId" uuid,
    "CreatedAt" timestamptz NOT NULL,
    "SubmittedAt" timestamptz,
    "PaidAt" timestamptz
);
CREATE INDEX "IX_expense_claims_EmployeeId" ON expense_claims ("EmployeeId");

CREATE TABLE expense_items (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ClaimId" uuid NOT NULL REFERENCES expense_claims("Id") ON DELETE CASCADE,
    "Category" text NOT NULL,
    "Amount" numeric NOT NULL,
    "ExpenseDate" date NOT NULL,
    "Description" text,
    "ReceiptStorageKey" text
);
CREATE INDEX "IX_expense_items_ClaimId" ON expense_items ("ClaimId");

CREATE TABLE expense_documents (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "FileName" text NOT NULL,
    "StorageKey" text NOT NULL,
    "SizeBytes" bigint NOT NULL,
    "ContentType" text,
    "UploadedAt" timestamptz NOT NULL,
    "UploadedByEmployeeId" uuid
);
CREATE INDEX "IX_expense_documents_EmployeeId" ON expense_documents ("EmployeeId");

CREATE TABLE expense_hr_cases (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Subject" text NOT NULL,
    "Description" text,
    "Category" text NOT NULL,
    "Priority" text NOT NULL,
    "Status" text NOT NULL,
    "AssignedToEmployeeId" uuid,
    "Resolution" text,
    "CreatedAt" timestamptz NOT NULL,
    "ResolvedAt" timestamptz
);
CREATE INDEX "IX_expense_hr_cases_Status" ON expense_hr_cases ("Status");
