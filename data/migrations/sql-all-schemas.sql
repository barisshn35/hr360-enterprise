-- HR360 kalan backend modulleri - birlesik sema
-- Kullanim (db-01'de):
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < sql-all-schemas.sql

-- ============================================================
-- recruitment-service
-- ============================================================
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

-- ============================================================
-- onboarding-service
-- ============================================================
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

-- ============================================================
-- leave-service
-- ============================================================
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

-- ============================================================
-- timeshift-service
-- ============================================================
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

-- ============================================================
-- performance-service
-- ============================================================
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

-- ============================================================
-- learning-service
-- ============================================================
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

-- ============================================================
-- compensation-service
-- ============================================================
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

-- ============================================================
-- expense-service
-- ============================================================
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

-- ============================================================
-- notification-service
-- ============================================================
CREATE TABLE notification_templates (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Code" text NOT NULL,
    "Channel" text NOT NULL,
    "Locale" text NOT NULL,
    "SubjectTemplate" text,
    "BodyTemplate" text NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_notification_templates_Code_Channel_Locale"
    ON notification_templates ("Code", "Channel", "Locale");

CREATE TABLE notification_messages (
    "Id" uuid NOT NULL PRIMARY KEY,
    "RecipientEmployeeId" uuid NOT NULL,
    "Channel" text NOT NULL,
    "TemplateCode" text,
    "Subject" text,
    "Body" text NOT NULL,
    "Status" text NOT NULL,
    "FailureReason" text,
    "AttemptCount" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "SentAt" timestamptz,
    "ReadAt" timestamptz
);
CREATE INDEX "IX_notification_messages_Recipient_Status"
    ON notification_messages ("RecipientEmployeeId", "Status");
