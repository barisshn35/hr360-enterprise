-- recruitment-service (Hafta 14) sema
-- Kullanim: db-01'de
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < schema.sql

CREATE TABLE recruitment_job_postings (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Title" text NOT NULL,
    "DepartmentId" uuid NOT NULL,
    "Description" text,
    "EmploymentType" text NOT NULL,
    "Status" text NOT NULL,
    "Headcount" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "PublishedAt" timestamptz,
    "ClosedAt" timestamptz
);

CREATE TABLE recruitment_candidates (
    "Id" uuid NOT NULL PRIMARY KEY,
    "FirstName" text NOT NULL,
    "LastName" text NOT NULL,
    "Email" text NOT NULL,
    "Phone" text,
    "ResumeStorageKey" text,
    "Source" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_recruitment_candidates_Email" ON recruitment_candidates ("Email");

CREATE TABLE recruitment_applications (
    "Id" uuid NOT NULL PRIMARY KEY,
    "JobPostingId" uuid NOT NULL REFERENCES recruitment_job_postings("Id") ON DELETE CASCADE,
    "CandidateId" uuid NOT NULL REFERENCES recruitment_candidates("Id") ON DELETE CASCADE,
    "Status" text NOT NULL,
    "Notes" text,
    "AppliedAt" timestamptz NOT NULL,
    "StatusChangedAt" timestamptz
);
CREATE UNIQUE INDEX "IX_recruitment_applications_Posting_Candidate"
    ON recruitment_applications ("JobPostingId", "CandidateId");

CREATE TABLE recruitment_interviews (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ApplicationId" uuid NOT NULL REFERENCES recruitment_applications("Id") ON DELETE CASCADE,
    "Type" text NOT NULL,
    "ScheduledAt" timestamptz NOT NULL,
    "InterviewerEmployeeId" uuid NOT NULL,
    "Result" text NOT NULL,
    "Score" integer,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_recruitment_interviews_ApplicationId"
    ON recruitment_interviews ("ApplicationId");
