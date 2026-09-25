-- HR360 kalan backend modulleri - birlesik sema
-- Kullanim (db-01'de):
--   docker exec -i db-postgres-1 psql -U hr360admin -d hr360_operational < sql-all-schemas.sql

-- NOT (hardcore test bulgusu, 2. tur): asagidaki 9 servisin TAMAMININ tablolari
-- EF Core modelleriyle senkron DEGILDI - bazilarinda TenantSlug sutunu hic
-- yoktu (multi-tenancy modellere sonradan eklenmis ama bu dosyaya hic
-- yansitilmamisti - her authenticated istek "column ... TenantSlug does not
-- exist" ile 500 donuyordu), bazilarinda (performance-service: review_scores,
-- scoring_config; timeshift-service: shift_overrides, shift_patterns,
-- shift_pattern_days, shift_teams, shift_team_members) TABLONUN KENDISI HIC
-- YOKTU. Asagidaki tanimlarin tamami, ayni once organization/employee/
-- workflow/tenant icin yapilan duzeltmede oldugu gibi, ilgili servislerin
-- GUNCEL EF Core modellerinden ("dotnet ef migrations script") birebir
-- uretildi - elle yazilmadi.
-- ============================================================

-- ============================================================
-- recruitment-service
-- ============================================================
CREATE TABLE recruitment_candidates (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "FirstName" text NOT NULL,
    "LastName" text NOT NULL,
    "Email" text NOT NULL,
    "Phone" text,
    "ResumeStorageKey" text,
    "Source" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_recruitment_candidates" PRIMARY KEY ("Id")
);

CREATE TABLE recruitment_job_postings (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Title" text NOT NULL,
    "DepartmentId" uuid NOT NULL,
    "Description" text,
    "EmploymentType" text NOT NULL,
    "Status" text NOT NULL,
    "Headcount" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "PublishedAt" timestamptz,
    "ClosedAt" timestamptz,
    CONSTRAINT "PK_recruitment_job_postings" PRIMARY KEY ("Id")
);

CREATE TABLE recruitment_applications (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "JobPostingId" uuid NOT NULL,
    "CandidateId" uuid NOT NULL,
    "Status" text NOT NULL,
    "Notes" text,
    "AppliedAt" timestamptz NOT NULL,
    "StatusChangedAt" timestamptz,
    CONSTRAINT "PK_recruitment_applications" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_recruitment_applications_recruitment_candidates_CandidateId" FOREIGN KEY ("CandidateId") REFERENCES recruitment_candidates ("Id") ON DELETE CASCADE,
    CONSTRAINT "FK_recruitment_applications_recruitment_job_postings_JobPostin~" FOREIGN KEY ("JobPostingId") REFERENCES recruitment_job_postings ("Id") ON DELETE CASCADE
);

CREATE TABLE recruitment_interviews (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "ApplicationId" uuid NOT NULL,
    "Type" text NOT NULL,
    "ScheduledAt" timestamptz NOT NULL,
    "InterviewerEmployeeId" uuid NOT NULL,
    "Result" text NOT NULL,
    "Score" integer,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_recruitment_interviews" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_recruitment_interviews_recruitment_applications_Application~" FOREIGN KEY ("ApplicationId") REFERENCES recruitment_applications ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_recruitment_applications_CandidateId" ON recruitment_applications ("CandidateId");

CREATE UNIQUE INDEX "IX_recruitment_applications_JobPostingId_CandidateId" ON recruitment_applications ("JobPostingId", "CandidateId");

CREATE INDEX "IX_recruitment_applications_TenantSlug" ON recruitment_applications ("TenantSlug");

CREATE UNIQUE INDEX "IX_recruitment_candidates_Email" ON recruitment_candidates ("Email");

CREATE INDEX "IX_recruitment_candidates_TenantSlug" ON recruitment_candidates ("TenantSlug");

CREATE INDEX "IX_recruitment_interviews_ApplicationId" ON recruitment_interviews ("ApplicationId");

CREATE INDEX "IX_recruitment_interviews_TenantSlug" ON recruitment_interviews ("TenantSlug");

CREATE INDEX "IX_recruitment_job_postings_TenantSlug" ON recruitment_job_postings ("TenantSlug");

-- ============================================================
-- onboarding-service
-- ============================================================
CREATE TABLE onboarding_assets (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "AssetTag" text NOT NULL,
    "Type" text NOT NULL,
    "Model" text,
    "SerialNumber" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_onboarding_assets" PRIMARY KEY ("Id")
);

CREATE TABLE onboarding_plans (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "StartDate" date NOT NULL,
    "TemplateName" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz,
    CONSTRAINT "PK_onboarding_plans" PRIMARY KEY ("Id")
);

CREATE TABLE onboarding_asset_assignments (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "AssetId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "AssignedOn" date NOT NULL,
    "ReturnedOn" date,
    "ConditionOnReturn" text,
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_onboarding_asset_assignments" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_onboarding_asset_assignments_onboarding_assets_AssetId" FOREIGN KEY ("AssetId") REFERENCES onboarding_assets ("Id") ON DELETE CASCADE
);

CREATE TABLE onboarding_tasks (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "PlanId" uuid NOT NULL,
    "Title" text NOT NULL,
    "Category" text NOT NULL,
    "DueDate" date,
    "AssigneeEmployeeId" uuid,
    "Status" text NOT NULL,
    "Order" integer NOT NULL,
    "CompletedAt" timestamptz,
    CONSTRAINT "PK_onboarding_tasks" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_onboarding_tasks_onboarding_plans_PlanId" FOREIGN KEY ("PlanId") REFERENCES onboarding_plans ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_onboarding_asset_assignments_AssetId" ON onboarding_asset_assignments ("AssetId");

CREATE INDEX "IX_onboarding_asset_assignments_EmployeeId" ON onboarding_asset_assignments ("EmployeeId");

CREATE INDEX "IX_onboarding_asset_assignments_TenantSlug" ON onboarding_asset_assignments ("TenantSlug");

CREATE UNIQUE INDEX "IX_onboarding_assets_AssetTag" ON onboarding_assets ("AssetTag");

CREATE INDEX "IX_onboarding_assets_TenantSlug" ON onboarding_assets ("TenantSlug");

CREATE INDEX "IX_onboarding_plans_EmployeeId" ON onboarding_plans ("EmployeeId");

CREATE INDEX "IX_onboarding_plans_TenantSlug" ON onboarding_plans ("TenantSlug");

CREATE INDEX "IX_onboarding_tasks_PlanId" ON onboarding_tasks ("PlanId");

CREATE INDEX "IX_onboarding_tasks_TenantSlug" ON onboarding_tasks ("TenantSlug");

-- ============================================================
-- leave-service
-- ============================================================
CREATE TABLE leave_balances (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Year" integer NOT NULL,
    "Type" text NOT NULL,
    "EntitledDays" numeric NOT NULL,
    "UsedDays" numeric NOT NULL,
    "PendingDays" numeric NOT NULL,
    "UpdatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_leave_balances" PRIMARY KEY ("Id")
);

CREATE TABLE leave_requests (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date NOT NULL,
    "Days" numeric NOT NULL,
    "Reason" text,
    "Status" text NOT NULL,
    "WorkflowRequestId" uuid,
    "CreatedAt" timestamptz NOT NULL,
    "DecidedAt" timestamptz,
    CONSTRAINT "PK_leave_requests" PRIMARY KEY ("Id")
);

CREATE UNIQUE INDEX "IX_leave_balances_EmployeeId_Year_Type" ON leave_balances ("EmployeeId", "Year", "Type");

CREATE INDEX "IX_leave_balances_TenantSlug" ON leave_balances ("TenantSlug");

CREATE INDEX "IX_leave_requests_EmployeeId" ON leave_requests ("EmployeeId");

CREATE INDEX "IX_leave_requests_Status" ON leave_requests ("Status");

CREATE INDEX "IX_leave_requests_TenantSlug" ON leave_requests ("TenantSlug");

-- ============================================================
-- timeshift-service
-- ============================================================
CREATE TABLE timeshift_shift_overrides (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Date" date NOT NULL,
    "Type" text NOT NULL,
    "Note" text,
    "StartTime" time without time zone,
    "EndTime" time without time zone,
    "IsSystemManaged" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_shift_overrides" PRIMARY KEY ("Id")
);

CREATE TABLE timeshift_shift_patterns (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_shift_patterns" PRIMARY KEY ("Id")
);

CREATE TABLE timeshift_shifts (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "StartTime" time without time zone NOT NULL,
    "EndTime" time without time zone NOT NULL,
    "BreakMinutes" integer NOT NULL,
    "DepartmentId" uuid,
    "IsNightShift" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_shifts" PRIMARY KEY ("Id")
);

CREATE TABLE timeshift_time_entries (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Date" date NOT NULL,
    "ClockIn" timestamptz,
    "ClockOut" timestamptz,
    "WorkedMinutes" integer NOT NULL,
    "OvertimeMinutes" integer NOT NULL,
    "Source" text NOT NULL,
    "Note" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_time_entries" PRIMARY KEY ("Id")
);

CREATE TABLE timeshift_shift_pattern_days (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "ShiftPatternId" uuid NOT NULL,
    "DayIndex" integer NOT NULL,
    "Type" text NOT NULL,
    "StartTime" time without time zone,
    "EndTime" time without time zone,
    CONSTRAINT "PK_timeshift_shift_pattern_days" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_timeshift_shift_pattern_days_timeshift_shift_patterns_Shift~" FOREIGN KEY ("ShiftPatternId") REFERENCES timeshift_shift_patterns ("Id") ON DELETE CASCADE
);

CREATE TABLE timeshift_shift_teams (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "ShiftPatternId" uuid NOT NULL,
    "AnchorDate" date NOT NULL,
    "DepartmentId" uuid,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_shift_teams" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_timeshift_shift_teams_timeshift_shift_patterns_ShiftPattern~" FOREIGN KEY ("ShiftPatternId") REFERENCES timeshift_shift_patterns ("Id") ON DELETE RESTRICT
);

CREATE TABLE timeshift_assignments (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "ShiftId" uuid NOT NULL,
    "Date" date NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_assignments" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_timeshift_assignments_timeshift_shifts_ShiftId" FOREIGN KEY ("ShiftId") REFERENCES timeshift_shifts ("Id") ON DELETE CASCADE
);

CREATE TABLE timeshift_shift_team_members (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "ShiftTeamId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Rank" integer NOT NULL,
    "Tag" text,
    "EffectiveFrom" date NOT NULL,
    "EffectiveTo" date,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_timeshift_shift_team_members" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_timeshift_shift_team_members_timeshift_shift_teams_ShiftTea~" FOREIGN KEY ("ShiftTeamId") REFERENCES timeshift_shift_teams ("Id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "IX_timeshift_assignments_EmployeeId_Date" ON timeshift_assignments ("EmployeeId", "Date");

CREATE INDEX "IX_timeshift_assignments_ShiftId" ON timeshift_assignments ("ShiftId");

CREATE INDEX "IX_timeshift_assignments_TenantSlug" ON timeshift_assignments ("TenantSlug");

CREATE UNIQUE INDEX "IX_timeshift_shift_overrides_EmployeeId_Date" ON timeshift_shift_overrides ("EmployeeId", "Date");

CREATE INDEX "IX_timeshift_shift_overrides_TenantSlug" ON timeshift_shift_overrides ("TenantSlug");

CREATE UNIQUE INDEX "IX_timeshift_shift_pattern_days_ShiftPatternId_DayIndex" ON timeshift_shift_pattern_days ("ShiftPatternId", "DayIndex");

CREATE INDEX "IX_timeshift_shift_pattern_days_TenantSlug" ON timeshift_shift_pattern_days ("TenantSlug");

CREATE INDEX "IX_timeshift_shift_patterns_TenantSlug" ON timeshift_shift_patterns ("TenantSlug");

CREATE INDEX "IX_timeshift_shift_team_members_EmployeeId_EffectiveFrom" ON timeshift_shift_team_members ("EmployeeId", "EffectiveFrom");

CREATE INDEX "IX_timeshift_shift_team_members_ShiftTeamId" ON timeshift_shift_team_members ("ShiftTeamId");

CREATE INDEX "IX_timeshift_shift_team_members_TenantSlug" ON timeshift_shift_team_members ("TenantSlug");

CREATE INDEX "IX_timeshift_shift_teams_ShiftPatternId" ON timeshift_shift_teams ("ShiftPatternId");

CREATE INDEX "IX_timeshift_shift_teams_TenantSlug" ON timeshift_shift_teams ("TenantSlug");

CREATE INDEX "IX_timeshift_shifts_TenantSlug" ON timeshift_shifts ("TenantSlug");

CREATE UNIQUE INDEX "IX_timeshift_time_entries_EmployeeId_Date" ON timeshift_time_entries ("EmployeeId", "Date");

CREATE INDEX "IX_timeshift_time_entries_TenantSlug" ON timeshift_time_entries ("TenantSlug");

-- ============================================================
-- performance-service
-- ============================================================
CREATE TABLE performance_cycles (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Year" integer NOT NULL,
    "Period" text NOT NULL,
    "StartDate" date NOT NULL,
    "EndDate" date NOT NULL,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_performance_cycles" PRIMARY KEY ("Id")
);

CREATE TABLE performance_feedback (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "FromEmployeeId" uuid NOT NULL,
    "ToEmployeeId" uuid NOT NULL,
    "CycleId" uuid,
    "MetricId" uuid,
    "Reason" text NOT NULL,
    "ReasonDetail" text,
    "Sentiment" text NOT NULL,
    "Body" text NOT NULL,
    "VisibleToEmployee" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "ReadAt" timestamptz,
    CONSTRAINT "PK_performance_feedback" PRIMARY KEY ("Id")
);

CREATE TABLE performance_metrics (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Code" text NOT NULL,
    "Name" text NOT NULL,
    "Description" text,
    "Category" text NOT NULL,
    "Scale" text NOT NULL,
    "Weight" numeric NOT NULL,
    "DepartmentId" uuid,
    "IsRequired" boolean NOT NULL,
    "IsActive" boolean NOT NULL,
    "SortOrder" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "ArchivedAt" timestamptz,
    CONSTRAINT "PK_performance_metrics" PRIMARY KEY ("Id")
);

CREATE TABLE performance_reviews (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "CycleId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "ReviewerEmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "Strengths" text,
    "Improvements" text,
    "Comments" text,
    "SubmittedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_performance_reviews" PRIMARY KEY ("Id")
);

CREATE TABLE performance_scoring_config (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Version" integer NOT NULL,
    "IsActive" boolean NOT NULL,
    "EffectiveFrom" timestamptz NOT NULL,
    "GoalWeightPercent" integer NOT NULL,
    "MetricWeightPercent" integer NOT NULL,
    "TechnicalWeight" numeric NOT NULL,
    "BehavioralWeight" numeric NOT NULL,
    "LeadershipWeight" numeric NOT NULL,
    "DeliveryWeight" numeric NOT NULL,
    "CustomWeight" numeric NOT NULL,
    "SelfReviewWeight" numeric NOT NULL,
    "ManagerReviewWeight" numeric NOT NULL,
    "TeamLeadReviewWeight" numeric NOT NULL,
    "PeerReviewWeight" numeric NOT NULL,
    "UpwardReviewWeight" numeric NOT NULL,
    "MinReviewsForValidScore" integer NOT NULL,
    "AllowSelfOnlyScore" boolean NOT NULL,
    "PromotionThreshold" numeric NOT NULL,
    "RecognitionThreshold" numeric NOT NULL,
    "ImprovementThreshold" numeric NOT NULL,
    "CriticalThreshold" numeric NOT NULL,
    "PromotionConsecutivePeriods" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "CreatedByEmployeeId" text,
    CONSTRAINT "PK_performance_scoring_config" PRIMARY KEY ("Id")
);

CREATE TABLE performance_snapshots (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "CycleId" uuid,
    "TeamId" uuid,
    "DepartmentId" uuid,
    "Score" numeric NOT NULL,
    "GoalScore" numeric NOT NULL,
    "MetricScore" numeric NOT NULL,
    "IsProvisional" boolean NOT NULL,
    "ProvisionalReason" text,
    "ReviewCount" integer NOT NULL,
    "ConfigVersion" integer NOT NULL,
    "CategoryBreakdownJson" text,
    "Source" text NOT NULL,
    "CapturedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_performance_snapshots" PRIMARY KEY ("Id")
);

CREATE TABLE performance_goals (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "CycleId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Title" text NOT NULL,
    "Description" text,
    "Weight" integer NOT NULL,
    "TargetValue" numeric,
    "CurrentValue" numeric,
    "Unit" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_performance_goals" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_performance_goals_performance_cycles_CycleId" FOREIGN KEY ("CycleId") REFERENCES performance_cycles ("Id") ON DELETE CASCADE
);

CREATE TABLE performance_review_scores (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "ReviewId" uuid NOT NULL,
    "MetricId" uuid NOT NULL,
    "Value" numeric NOT NULL,
    "Comment" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_performance_review_scores" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_performance_review_scores_performance_metrics_MetricId" FOREIGN KEY ("MetricId") REFERENCES performance_metrics ("Id") ON DELETE RESTRICT,
    CONSTRAINT "FK_performance_review_scores_performance_reviews_ReviewId" FOREIGN KEY ("ReviewId") REFERENCES performance_reviews ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_performance_cycles_TenantSlug" ON performance_cycles ("TenantSlug");

CREATE INDEX "IX_performance_feedback_FromEmployeeId" ON performance_feedback ("FromEmployeeId");

CREATE INDEX "IX_performance_feedback_TenantSlug" ON performance_feedback ("TenantSlug");

CREATE INDEX "IX_performance_feedback_ToEmployeeId" ON performance_feedback ("ToEmployeeId");

CREATE INDEX "IX_performance_goals_CycleId" ON performance_goals ("CycleId");

CREATE INDEX "IX_performance_goals_EmployeeId" ON performance_goals ("EmployeeId");

CREATE INDEX "IX_performance_goals_TenantSlug" ON performance_goals ("TenantSlug");

CREATE INDEX "IX_performance_metrics_TenantSlug" ON performance_metrics ("TenantSlug");

CREATE UNIQUE INDEX "IX_performance_metrics_TenantSlug_Code" ON performance_metrics ("TenantSlug", "Code");

CREATE INDEX "IX_performance_review_scores_MetricId" ON performance_review_scores ("MetricId");

CREATE UNIQUE INDEX "IX_performance_review_scores_ReviewId_MetricId" ON performance_review_scores ("ReviewId", "MetricId");

CREATE INDEX "IX_performance_review_scores_TenantSlug" ON performance_review_scores ("TenantSlug");

CREATE INDEX "IX_performance_reviews_CycleId_EmployeeId" ON performance_reviews ("CycleId", "EmployeeId");

CREATE INDEX "IX_performance_reviews_TenantSlug" ON performance_reviews ("TenantSlug");

CREATE INDEX "IX_performance_scoring_config_TenantSlug" ON performance_scoring_config ("TenantSlug");

CREATE UNIQUE INDEX "IX_performance_scoring_config_TenantSlug_Version" ON performance_scoring_config ("TenantSlug", "Version");

CREATE INDEX "IX_performance_snapshots_EmployeeId_CapturedAt" ON performance_snapshots ("EmployeeId", "CapturedAt");

CREATE INDEX "IX_performance_snapshots_TeamId_CapturedAt" ON performance_snapshots ("TeamId", "CapturedAt");

CREATE INDEX "IX_performance_snapshots_TenantSlug" ON performance_snapshots ("TenantSlug");

-- ============================================================
-- learning-service
-- ============================================================
CREATE TABLE learning_certifications (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Name" text NOT NULL,
    "Issuer" text,
    "CredentialId" text,
    "IssuedOn" date NOT NULL,
    "ExpiresOn" date,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_learning_certifications" PRIMARY KEY ("Id")
);

CREATE TABLE learning_courses (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Title" text NOT NULL,
    "Description" text,
    "Provider" text,
    "DurationHours" numeric NOT NULL,
    "Category" text NOT NULL,
    "IsMandatory" boolean NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_learning_courses" PRIMARY KEY ("Id")
);

CREATE TABLE learning_enrollments (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "CourseId" uuid NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Status" text NOT NULL,
    "Score" numeric,
    "EnrolledAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz,
    CONSTRAINT "PK_learning_enrollments" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_learning_enrollments_learning_courses_CourseId" FOREIGN KEY ("CourseId") REFERENCES learning_courses ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_learning_certifications_EmployeeId" ON learning_certifications ("EmployeeId");

CREATE INDEX "IX_learning_certifications_TenantSlug" ON learning_certifications ("TenantSlug");

CREATE INDEX "IX_learning_courses_TenantSlug" ON learning_courses ("TenantSlug");

CREATE UNIQUE INDEX "IX_learning_enrollments_CourseId_EmployeeId" ON learning_enrollments ("CourseId", "EmployeeId");

CREATE INDEX "IX_learning_enrollments_TenantSlug" ON learning_enrollments ("TenantSlug");

-- ============================================================
-- compensation-service
-- ============================================================
CREATE TABLE compensation_records (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "BaseSalary" numeric NOT NULL,
    "Currency" text NOT NULL,
    "Grade" text,
    "Reason" text NOT NULL,
    "EffectiveFrom" date NOT NULL,
    "EffectiveTo" date,
    "Note" text,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_compensation_records" PRIMARY KEY ("Id")
);

CREATE TABLE compensation_salary_bands (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Grade" text NOT NULL,
    "Title" text,
    "MinAmount" numeric NOT NULL,
    "MidAmount" numeric NOT NULL,
    "MaxAmount" numeric NOT NULL,
    "Currency" text NOT NULL,
    "Year" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_compensation_salary_bands" PRIMARY KEY ("Id")
);

CREATE INDEX "IX_compensation_records_EmployeeId" ON compensation_records ("EmployeeId");

CREATE INDEX "IX_compensation_records_TenantSlug" ON compensation_records ("TenantSlug");

CREATE UNIQUE INDEX "IX_compensation_salary_bands_Grade_Year" ON compensation_salary_bands ("Grade", "Year");

CREATE INDEX "IX_compensation_salary_bands_TenantSlug" ON compensation_salary_bands ("TenantSlug");

-- ============================================================
-- expense-service
-- ============================================================
CREATE TABLE expense_claims (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Title" text NOT NULL,
    "Currency" text NOT NULL,
    "TotalAmount" numeric NOT NULL,
    "Status" text NOT NULL,
    "WorkflowRequestId" uuid,
    "ApprovedByEmployeeId" uuid,
    "CreatedAt" timestamptz NOT NULL,
    "SubmittedAt" timestamptz,
    "PaidAt" timestamptz,
    CONSTRAINT "PK_expense_claims" PRIMARY KEY ("Id")
);

CREATE TABLE expense_documents (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Type" text NOT NULL,
    "FileName" text NOT NULL,
    "StorageKey" text NOT NULL,
    "SizeBytes" bigint NOT NULL,
    "ContentType" text,
    "UploadedAt" timestamptz NOT NULL,
    "UploadedByEmployeeId" uuid,
    CONSTRAINT "PK_expense_documents" PRIMARY KEY ("Id")
);

CREATE TABLE expense_hr_cases (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Subject" text NOT NULL,
    "Description" text,
    "Category" text NOT NULL,
    "Priority" text NOT NULL,
    "Status" text NOT NULL,
    "AssignedToEmployeeId" uuid,
    "Resolution" text,
    "CreatedAt" timestamptz NOT NULL,
    "ResolvedAt" timestamptz,
    CONSTRAINT "PK_expense_hr_cases" PRIMARY KEY ("Id")
);

CREATE TABLE expense_items (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "ClaimId" uuid NOT NULL,
    "Category" text NOT NULL,
    "Amount" numeric NOT NULL,
    "ExpenseDate" date NOT NULL,
    "Description" text,
    "ReceiptStorageKey" text,
    CONSTRAINT "PK_expense_items" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_expense_items_expense_claims_ClaimId" FOREIGN KEY ("ClaimId") REFERENCES expense_claims ("Id") ON DELETE CASCADE
);

CREATE INDEX "IX_expense_claims_EmployeeId" ON expense_claims ("EmployeeId");

CREATE INDEX "IX_expense_claims_TenantSlug" ON expense_claims ("TenantSlug");

CREATE INDEX "IX_expense_documents_EmployeeId" ON expense_documents ("EmployeeId");

CREATE INDEX "IX_expense_documents_TenantSlug" ON expense_documents ("TenantSlug");

CREATE INDEX "IX_expense_hr_cases_Status" ON expense_hr_cases ("Status");

CREATE INDEX "IX_expense_hr_cases_TenantSlug" ON expense_hr_cases ("TenantSlug");

CREATE INDEX "IX_expense_items_ClaimId" ON expense_items ("ClaimId");

CREATE INDEX "IX_expense_items_TenantSlug" ON expense_items ("TenantSlug");

-- ============================================================
-- notification-service
-- ============================================================
CREATE TABLE notification_messages (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "RecipientEmployeeId" uuid NOT NULL,
    "RecipientEmail" text,
    "Channel" text NOT NULL,
    "TemplateCode" text,
    "Subject" text,
    "Body" text NOT NULL,
    "Status" text NOT NULL,
    "FailureReason" text,
    "AttemptCount" integer NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "SentAt" timestamptz,
    "ReadAt" timestamptz,
    CONSTRAINT "PK_notification_messages" PRIMARY KEY ("Id")
);

CREATE TABLE notification_templates (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Code" text NOT NULL,
    "Channel" text NOT NULL,
    "Locale" text NOT NULL,
    "SubjectTemplate" text,
    "BodyTemplate" text NOT NULL,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_notification_templates" PRIMARY KEY ("Id")
);

CREATE INDEX "IX_notification_messages_RecipientEmployeeId_Status" ON notification_messages ("RecipientEmployeeId", "Status");

CREATE INDEX "IX_notification_messages_TenantSlug" ON notification_messages ("TenantSlug");

CREATE UNIQUE INDEX "IX_notification_templates_Code_Channel_Locale" ON notification_templates ("Code", "Channel", "Locale");

CREATE INDEX "IX_notification_templates_TenantSlug" ON notification_templates ("TenantSlug");

-- --- paylasilan 'islenmis event' (Kafka tuketici idempotency) tablosu ---
-- expense-service, leave-service, notification-service ve timeshift-service'in
-- HEPSI ayni "messaging_processed_events" tablosunu kullanir (bkz. her birinin
-- Messaging/ProcessedEvent.cs dosyasindaki aciklama, ozellikle expense-service'teki
-- "TUM tuketici servisler arasinda paylasilan ORTAK bir tablodur" notu) - ama bu
-- tablo bu dosyada HICBIR ZAMAN yoktu, yani at-least-once Kafka teslimatinda
-- olay tekilleştirme (deduplication) hicbir zaman calismiyordu.
CREATE TABLE messaging_processed_events (
    "EventId" uuid NOT NULL,
    "Consumer" text NOT NULL,
    "EventType" text NOT NULL,
    "ProcessedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_messaging_processed_events" PRIMARY KEY ("EventId", "Consumer")
);

-- ============================================================
-- organization-service, employee-service, workflow-service,
-- tenant-service ve paylasilan outbox tablosu
--
-- NOT (hardcore test bulgusu): asagidaki 5 blok daha once bu dosyada HIC
-- yoktu. organization-service ve employee-service Database.EnsureCreated()
-- ile "kendi" tablolarini kendileri olusturuyor sanildi, ama EnsureCreated()
-- PAYLASILAN bir veritabaninda "herhangi bir tablo var mi" diye bakar - bu
-- dosyadaki diger servislerin tablolari zaten var oldugu icin EnsureCreated()
-- hicbir sey yapmadan sessizce cikiyor ve bu iki servisin KENDI tablolari
-- HICBIR ZAMAN olusmuyordu. workflow-service'in ise ne bir schema.sql'i ne
-- de EnsureCreated/Migrate cagrisi vardi - tablolari asla olusmuyordu.
-- tenant-service'in kendi sql/schema.sql'i vardi ama bu birlesik dosyaya
-- hic eklenmemisti (ayrica o dosya LogoUrl/SMTP alanlari eklendikten sonra
-- guncellenmemis, eskimisti). Asagidaki tablolar ilgili servislerin GUNCEL
-- EF Core modellerinden ("dotnet ef migrations script") birebir uretildi.
-- ============================================================

-- --- organization-service ---
CREATE TABLE organization_companies (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "TaxNumber" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_organization_companies_TenantSlug" ON organization_companies ("TenantSlug");

CREATE TABLE organization_departments (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "CompanyId" uuid NOT NULL REFERENCES organization_companies ("Id") ON DELETE CASCADE,
    "ParentDepartmentId" uuid,
    "HeadEmployeeId" uuid,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_organization_departments_CompanyId" ON organization_departments ("CompanyId");
CREATE INDEX "IX_organization_departments_TenantSlug" ON organization_departments ("TenantSlug");

CREATE TABLE organization_teams (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Description" text,
    "DepartmentId" uuid NOT NULL REFERENCES organization_departments ("Id") ON DELETE CASCADE,
    "LeadEmployeeId" uuid,
    "IsActive" boolean NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_organization_teams_DepartmentId" ON organization_teams ("DepartmentId");
CREATE INDEX "IX_organization_teams_TenantSlug" ON organization_teams ("TenantSlug");

CREATE TABLE organization_team_members (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "TeamId" uuid NOT NULL REFERENCES organization_teams ("Id") ON DELETE CASCADE,
    "EmployeeId" uuid NOT NULL,
    "RoleInTeam" text,
    "JoinedOn" date NOT NULL,
    "LeftOn" date,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_organization_team_members_EmployeeId" ON organization_team_members ("EmployeeId");
CREATE INDEX "IX_organization_team_members_TeamId" ON organization_team_members ("TeamId");
CREATE INDEX "IX_organization_team_members_TenantSlug" ON organization_team_members ("TenantSlug");

-- --- employee-service ---
CREATE TABLE employee_employees (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "FirstName" text NOT NULL,
    "LastName" text NOT NULL,
    "Email" text NOT NULL,
    "Phone" text,
    "KeycloakUserId" text,
    "HireDate" date NOT NULL,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX "IX_employee_employees_Email" ON employee_employees ("Email");
CREATE INDEX "IX_employee_employees_TenantSlug" ON employee_employees ("TenantSlug");

CREATE TABLE employee_assignments (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL REFERENCES employee_employees ("Id") ON DELETE CASCADE,
    "DepartmentId" uuid NOT NULL,
    "PositionTitle" text,
    "EffectiveFrom" date NOT NULL,
    "EffectiveTo" date,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_employee_assignments_EmployeeId" ON employee_assignments ("EmployeeId");
CREATE INDEX "IX_employee_assignments_TenantSlug" ON employee_assignments ("TenantSlug");

-- --- workflow-service ---
CREATE TABLE workflow_requests (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Type" text NOT NULL,
    "Status" text NOT NULL,
    "RequesterEmployeeId" uuid NOT NULL,
    "Subject" text,
    "Payload" text,
    "SlaDueAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz
);
CREATE INDEX "IX_workflow_requests_TenantSlug" ON workflow_requests ("TenantSlug");

CREATE TABLE workflow_approval_steps (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "WorkflowRequestId" uuid NOT NULL REFERENCES workflow_requests ("Id") ON DELETE CASCADE,
    "Order" integer NOT NULL,
    "ApproverEmployeeId" uuid NOT NULL,
    "DelegatedToEmployeeId" uuid,
    "Decision" text NOT NULL,
    "Comment" text,
    "DecidedAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX "IX_workflow_approval_steps_TenantSlug" ON workflow_approval_steps ("TenantSlug");
CREATE INDEX "IX_workflow_approval_steps_WorkflowRequestId" ON workflow_approval_steps ("WorkflowRequestId");

-- --- tenant-service ---
CREATE TABLE platform_tenants (
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
    "LogoUrl" text,
    "PrimaryColorHex" text,
    "SmtpHost" text,
    "SmtpPort" integer,
    "SmtpUser" text,
    "SmtpPasswordEncrypted" text,
    "SmtpFromAddress" text,
    "SmtpFromName" text,
    "CreatedAt" timestamptz NOT NULL,
    "ActivatedAt" timestamptz,
    "SuspendedAt" timestamptz,
    "SuspendReason" text
);
CREATE UNIQUE INDEX "IX_platform_tenants_Slug" ON platform_tenants ("Slug");
CREATE INDEX "IX_platform_tenants_AdminEmail" ON platform_tenants ("AdminEmail");

CREATE TABLE platform_tenant_provisioning_log (
    "Id" uuid NOT NULL PRIMARY KEY,
    "TenantId" uuid NOT NULL,
    "Step" text NOT NULL,
    "Success" boolean NOT NULL,
    "Detail" text,
    "OccurredAt" timestamptz NOT NULL
);
CREATE INDEX "IX_platform_tenant_provisioning_log_TenantId" ON platform_tenant_provisioning_log ("TenantId");

-- --- paylasilan transactional outbox tablosu ---
-- employee-service, workflow-service, expense-service ve leave-service'in
-- HEPSI ayni "messaging_outbox" tablosunu kullanir (bkz. her birinin
-- Messaging/OutboxMessage.cs dosyasindaki aciklama) - yeni bir olay
-- yayinlama mekanizmasi eklendiginde tablo TEKRAR olusturulmamali, bu
-- tanim tek ve paylasilan olmalidir.
CREATE TABLE messaging_outbox (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Topic" text NOT NULL,
    "EventType" text NOT NULL,
    "PartitionKey" text NOT NULL,
    "Payload" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "PublishedAt" timestamptz,
    "AttemptCount" integer NOT NULL,
    "LastError" text
);
CREATE INDEX "IX_messaging_outbox_PublishedAt_CreatedAt" ON messaging_outbox ("PublishedAt", "CreatedAt");
