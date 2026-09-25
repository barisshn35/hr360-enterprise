-- learning-service (Hafta 20) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE learning_courses (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Title" text NOT NULL,
    "Description" text,
    "Provider" text,
    "DurationHours" numeric NOT NULL,
    "Category" text NOT NULL,
    "IsMandatory" boolean NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE learning_enrollments (
    "Id" uuid NOT NULL PRIMARY KEY,
    "CourseId" uuid NOT NULL REFERENCES learning_courses("Id") ON DELETE CASCADE,
    "EmployeeId" uuid NOT NULL,
    "Status" text NOT NULL,
    "Score" numeric,
    "EnrolledAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz
);
CREATE UNIQUE INDEX "IX_learning_enrollments_Course_Employee"
    ON learning_enrollments ("CourseId", "EmployeeId");

CREATE TABLE learning_certifications (
    "Id" uuid NOT NULL PRIMARY KEY,
    "EmployeeId" uuid NOT NULL,
    "Name" text NOT NULL,
    "Issuer" text,
    "CredentialId" text,
    "IssuedOn" date NOT NULL,
    "ExpiresOn" date,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_learning_certifications_EmployeeId"
    ON learning_certifications ("EmployeeId");
