-- HR360 - tum servislerin birlesik semasi (hr360_operational veritabani).
-- Kullanim: elle calistirilmaz. docker-compose.yml bu dosyayi Postgres'in
-- docker-entrypoint-initdb.d klasorune baglar; veritabani ILK KEZ olusurken
-- otomatik uygulanir. Mevcut kurulumlarin semasi scripts/sql/*.sql gocleriyle
-- guncellenir (install.sh guncelleme yolu bunlari otomatik calistirir).
--
-- ONEMLI: Dosyanin buyuk kismi EF Core modellerinden uretildi, ancak sondaki
-- "CTO denetimi" bolumu ve bazi indeksler (lower("Email") ile kiraci bazli
-- e-posta tekilligi, kismi/filtreli indeksler) ELLE yazildi. Dosya EF'ten
-- yeniden uretilirse bu satirlar korunmali. Servislerin eski sql/schema.sql
-- dosyalari kaldirildi; tek kaynak bu dosyadir.

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

CREATE UNIQUE INDEX "IX_recruitment_candidates_TenantSlug_Email" ON recruitment_candidates ("TenantSlug", "Email");

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

CREATE UNIQUE INDEX "IX_onboarding_assets_TenantSlug_AssetTag" ON onboarding_assets ("TenantSlug", "AssetTag");

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

CREATE UNIQUE INDEX "IX_compensation_salary_bands_TenantSlug_Grade_Year" ON compensation_salary_bands ("TenantSlug", "Grade", "Year");

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

CREATE UNIQUE INDEX "IX_notification_templates_TenantSlug_Code_Channel_Locale" ON notification_templates ("TenantSlug", "Code", "Channel", "Locale");

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
CREATE UNIQUE INDEX "IX_employee_employees_TenantSlug_Email" ON employee_employees ("TenantSlug", lower("Email"));
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
    "SuspendReason" text,
    "SuspendedUserIdsJson" text
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

-- CTO denetimi (2026-09-25): ek butunluk kisitlari
CREATE UNIQUE INDEX "IX_employee_employees_KeycloakUserId" ON employee_employees ("KeycloakUserId") WHERE "KeycloakUserId" IS NOT NULL;
CREATE UNIQUE INDEX "UX_onboarding_asset_assignments_open" ON onboarding_asset_assignments ("AssetId") WHERE "ReturnedOn" IS NULL;

-- Resmi tatil takvimi (leave-service): izin gunu hesabinda dusulur.
CREATE TABLE IF NOT EXISTS leave_public_holidays (
    "Id" uuid NOT NULL,
    "TenantSlug" character varying(64) NOT NULL,
    "Date" date NOT NULL,
    "Name" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    CONSTRAINT "PK_leave_public_holidays" PRIMARY KEY ("Id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IX_leave_public_holidays_TenantSlug_Date"
    ON leave_public_holidays ("TenantSlug", "Date");

-- ==== 2026-10-02: scripts/sql/2026-10-02_engagement_governance.sql ile ayni (ilk kurulum icin) ====
-- =============================================================================
-- 2026-10-02 — Çalışan deneyimi (engagement-service), yönetişim
-- (governance-service) ve denetim kaydı (tüm servisler) tabloları.
--
-- Bu dosya IDEMPOTENT'tir: hem install.sh güncellemesinde (scripts/sql/*.sql)
-- hem de ilk kurulumda (data/migrations/sql-all-schemas.sql sonuna eklenmiş
-- kopyası) güvenle çalışır.
-- =============================================================================

-- ---------------------------------------------------------------- denetim kaydı
-- Her servisin EF SaveChanges kesicisi (Auditing/AuditInterceptor.cs) değişen
-- her varlık için bir satır yazar: eski/yeni değer, kullanıcı, zaman, istek
-- kimliği. Hassas alanlar (maaş, IBAN, TCKN, parola…) "***" olarak maskelenir.
CREATE TABLE IF NOT EXISTS audit_log (
    "Id" bigserial PRIMARY KEY,
    "TenantSlug" character varying(64),
    "Service" text NOT NULL,
    "EntityType" text NOT NULL,
    "EntityId" text,
    "Action" text NOT NULL,
    "Changes" jsonb,
    "UserId" text,
    "UserName" text,
    "CorrelationId" text,
    "IpAddress" text,
    "OccurredAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IX_audit_log_Tenant_Occurred" ON audit_log ("TenantSlug", "OccurredAt" DESC);
CREATE INDEX IF NOT EXISTS "IX_audit_log_Entity" ON audit_log ("EntityType", "EntityId");
CREATE INDEX IF NOT EXISTS "IX_audit_log_Correlation" ON audit_log ("CorrelationId");

-- ------------------------------------------------------------- engagement-service
CREATE TABLE IF NOT EXISTS engagement_kudos (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "FromUserId" text NOT NULL,
    "FromEmployeeId" uuid,
    "FromName" text NOT NULL,
    "ToEmployeeId" uuid NOT NULL,
    "ToName" text NOT NULL,
    "Badge" text NOT NULL,
    "Message" text NOT NULL,
    "LikedBy" text[] NOT NULL DEFAULT '{}',
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_engagement_kudos_TenantSlug" ON engagement_kudos ("TenantSlug", "CreatedAt" DESC);

CREATE TABLE IF NOT EXISTS engagement_profiles (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "BirthDate" date,
    "ShowBirthday" boolean NOT NULL DEFAULT true,
    "Bio" text,
    "Pronouns" text,
    "Skills" text[] NOT NULL DEFAULT '{}',
    "Interests" text[] NOT NULL DEFAULT '{}',
    "Address" text,
    "EmergencyContactName" text,
    "EmergencyContactPhone" text,
    "Iban" text,
    "NationalId" text,
    "LinkedInUrl" text,
    "UpdatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_profiles_Employee" ON engagement_profiles ("TenantSlug", "EmployeeId");

CREATE TABLE IF NOT EXISTS engagement_desks (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Code" text NOT NULL,
    "Name" text NOT NULL,
    "Kind" text NOT NULL,
    "Floor" text,
    "Zone" text,
    "Capacity" integer NOT NULL DEFAULT 1,
    "Features" text[] NOT NULL DEFAULT '{}',
    "IsActive" boolean NOT NULL DEFAULT true,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_desks_Code" ON engagement_desks ("TenantSlug", "Code");

CREATE TABLE IF NOT EXISTS engagement_desk_bookings (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "DeskId" uuid NOT NULL REFERENCES engagement_desks("Id") ON DELETE CASCADE,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "Date" date NOT NULL,
    "StartMinute" integer NOT NULL,
    "EndMinute" integer NOT NULL,
    "Title" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_engagement_desk_bookings_Date" ON engagement_desk_bookings ("TenantSlug", "Date");

CREATE TABLE IF NOT EXISTS engagement_presence (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "Date" date NOT NULL,
    "Mode" text NOT NULL,
    "Note" text,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_presence_User_Date" ON engagement_presence ("TenantSlug", "UserId", "Date");

CREATE TABLE IF NOT EXISTS engagement_mentor_profiles (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "IsMentor" boolean NOT NULL,
    "IsMentee" boolean NOT NULL,
    "Offers" text[] NOT NULL DEFAULT '{}',
    "Wants" text[] NOT NULL DEFAULT '{}',
    "Capacity" integer NOT NULL DEFAULT 2,
    "Bio" text,
    "UpdatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_mentor_profiles_User" ON engagement_mentor_profiles ("TenantSlug", "UserId");

CREATE TABLE IF NOT EXISTS engagement_mentorships (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "MentorUserId" text NOT NULL,
    "MentorName" text NOT NULL,
    "MenteeUserId" text NOT NULL,
    "MenteeName" text NOT NULL,
    "Goal" text,
    "Status" text NOT NULL,
    "MatchScore" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL,
    "StartedAt" timestamptz,
    "EndedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS "IX_engagement_mentorships_TenantSlug" ON engagement_mentorships ("TenantSlug");

CREATE TABLE IF NOT EXISTS engagement_internal_applications (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "JobPostingId" uuid NOT NULL,
    "JobTitle" text NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "Motivation" text,
    "Status" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_internal_app" ON engagement_internal_applications ("TenantSlug", "JobPostingId", "UserId");

CREATE TABLE IF NOT EXISTS engagement_one_on_ones (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "ManagerUserId" text NOT NULL,
    "ManagerName" text NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "EmployeeUserId" text,
    "EmployeeName" text NOT NULL,
    "ScheduledAt" timestamptz NOT NULL,
    "Status" text NOT NULL,
    "Agenda" jsonb NOT NULL DEFAULT '[]',
    "SharedNotes" text,
    "PrivateNotes" text,
    "ActionItems" jsonb NOT NULL DEFAULT '[]',
    "Mood" integer,
    "CreatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_engagement_one_on_ones_Tenant" ON engagement_one_on_ones ("TenantSlug", "ScheduledAt");

CREATE TABLE IF NOT EXISTS engagement_succession_plans (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "PositionTitle" text NOT NULL,
    "DepartmentName" text,
    "IncumbentEmployeeId" uuid,
    "IncumbentName" text,
    "Criticality" text NOT NULL,
    "VacancyRisk" text NOT NULL,
    "Candidates" jsonb NOT NULL DEFAULT '[]',
    "Notes" text,
    "CreatedAt" timestamptz NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement_surveys (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Title" text NOT NULL,
    "Description" text,
    "Kind" text NOT NULL,
    "Questions" jsonb NOT NULL DEFAULT '[]',
    "IsAnonymous" boolean NOT NULL DEFAULT true,
    "Status" text NOT NULL,
    "ClosesAt" timestamptz,
    "CreatedByName" text,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS engagement_survey_responses (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "SurveyId" uuid NOT NULL REFERENCES engagement_surveys("Id") ON DELETE CASCADE,
    "RespondentKey" text NOT NULL,
    "DepartmentName" text,
    "Answers" jsonb NOT NULL,
    "SubmittedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_engagement_survey_resp" ON engagement_survey_responses ("SurveyId", "RespondentKey");

CREATE TABLE IF NOT EXISTS engagement_offboarding_cases (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "EmployeeName" text NOT NULL,
    "LastWorkingDay" date NOT NULL,
    "Reason" text NOT NULL,
    "Status" text NOT NULL,
    "Checklist" jsonb NOT NULL DEFAULT '[]',
    "ExitInterview" jsonb,
    "RehireEligible" boolean,
    "CreatedAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS engagement_org_scenarios (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Description" text,
    "Moves" jsonb NOT NULL DEFAULT '[]',
    "Status" text NOT NULL,
    "CreatedByName" text,
    "CreatedAt" timestamptz NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);

-- ------------------------------------------------------------- governance-service
CREATE TABLE IF NOT EXISTS governance_events (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64),
    "Topic" text NOT NULL,
    "EventType" text NOT NULL,
    "Payload" jsonb,
    "OccurredAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_governance_events_Tenant" ON governance_events ("TenantSlug", "OccurredAt" DESC);

CREATE TABLE IF NOT EXISTS governance_consents (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "ConsentType" text NOT NULL,
    "Version" text NOT NULL,
    "Granted" boolean NOT NULL,
    "IpAddress" text,
    "RecordedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_governance_consents_User" ON governance_consents ("TenantSlug", "UserId");

CREATE TABLE IF NOT EXISTS governance_data_requests (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "PersonName" text NOT NULL,
    "Kind" text NOT NULL,
    "Details" text,
    "Status" text NOT NULL,
    "Response" text,
    "DueAt" timestamptz NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "CompletedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS governance_retention_policies (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Category" text NOT NULL,
    "RetentionMonths" integer NOT NULL,
    "Action" text NOT NULL,
    "IsEnabled" boolean NOT NULL,
    "LastRunAt" timestamptz,
    "LastAffected" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_governance_retention" ON governance_retention_policies ("TenantSlug", "Category");

CREATE TABLE IF NOT EXISTS governance_doc_templates (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Category" text NOT NULL,
    "Body" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_rules (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Description" text,
    "Trigger" text NOT NULL,
    "Conditions" jsonb NOT NULL DEFAULT '[]',
    "Actions" jsonb NOT NULL DEFAULT '[]',
    "IsEnabled" boolean NOT NULL,
    "FireCount" integer NOT NULL DEFAULT 0,
    "LastFiredAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_rule_runs (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "RuleId" uuid NOT NULL,
    "RuleName" text NOT NULL,
    "EventType" text NOT NULL,
    "Result" text NOT NULL,
    "OccurredAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_governance_rule_runs" ON governance_rule_runs ("TenantSlug", "OccurredAt" DESC);

CREATE TABLE IF NOT EXISTS governance_webhooks (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Url" text NOT NULL,
    "Secret" text NOT NULL,
    "Events" text[] NOT NULL DEFAULT '{}',
    "IsEnabled" boolean NOT NULL,
    "LastStatus" integer,
    "LastDeliveredAt" timestamptz,
    "FailureCount" integer NOT NULL DEFAULT 0,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_webhook_deliveries (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "WebhookId" uuid NOT NULL,
    "EventType" text NOT NULL,
    "StatusCode" integer,
    "Error" text,
    "DurationMs" integer NOT NULL,
    "OccurredAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "IX_governance_webhook_deliveries" ON governance_webhook_deliveries ("WebhookId", "OccurredAt" DESC);

CREATE TABLE IF NOT EXISTS governance_api_keys (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Name" text NOT NULL,
    "Prefix" text NOT NULL,
    "KeyHash" text NOT NULL,
    "Scopes" text[] NOT NULL DEFAULT '{}',
    "CreatedByName" text,
    "CreatedAt" timestamptz NOT NULL,
    "LastUsedAt" timestamptz,
    "RevokedAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_governance_api_keys_Hash" ON governance_api_keys ("KeyHash");

CREATE TABLE IF NOT EXISTS governance_integrations (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Kind" text NOT NULL,
    "Name" text NOT NULL,
    "WebhookUrl" text NOT NULL,
    "Events" text[] NOT NULL DEFAULT '{}',
    "SigningSecret" text,
    "IsEnabled" boolean NOT NULL,
    "LastStatus" integer,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_invoices (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Number" text NOT NULL,
    "Period" text NOT NULL,
    "Plan" text NOT NULL,
    "Seats" integer NOT NULL,
    "UnitPrice" numeric(12,2) NOT NULL,
    "Amount" numeric(12,2) NOT NULL,
    "TaxAmount" numeric(12,2) NOT NULL,
    "Total" numeric(12,2) NOT NULL,
    "Currency" text NOT NULL,
    "Status" text NOT NULL,
    "IssuedAt" timestamptz NOT NULL,
    "DueAt" timestamptz NOT NULL,
    "PaidAt" timestamptz,
    "PaymentRef" text
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_governance_invoices_Period" ON governance_invoices ("TenantSlug", "Period");

CREATE TABLE IF NOT EXISTS governance_calendar_feeds (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text NOT NULL,
    "EmployeeId" uuid,
    "Token" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "UX_governance_calendar_feeds_Token" ON governance_calendar_feeds ("Token");
CREATE UNIQUE INDEX IF NOT EXISTS "UX_governance_calendar_feeds_User" ON governance_calendar_feeds ("TenantSlug", "UserId");

CREATE TABLE IF NOT EXISTS governance_kb_articles (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Title" text NOT NULL,
    "Body" text NOT NULL,
    "Tags" text[] NOT NULL DEFAULT '{}',
    "CreatedAt" timestamptz NOT NULL,
    "UpdatedAt" timestamptz NOT NULL
);

-- ------------------------------------------------- analitik (hafif veri ambarı)
-- Operasyonel tabloların üstünde, raporlama için sabitlenmiş görünümler. BI
-- aracı (Metabase/Power BI) bağlanacaksa bu görünümler okunur; operasyonel
-- şemadaki değişiklik raporları kırmaz.
CREATE OR REPLACE VIEW analytics_hires_monthly AS
SELECT "TenantSlug" AS tenant_slug,
       date_trunc('month', "HireDate")::date AS month,
       count(*) AS hires
FROM employee_employees
GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics_leave_monthly AS
SELECT "TenantSlug" AS tenant_slug,
       date_trunc('month', "StartDate")::date AS month,
       "Type" AS leave_type,
       "Status" AS status,
       count(*) AS requests,
       sum("Days") AS days
FROM leave_requests
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW analytics_department_headcount AS
SELECT a."TenantSlug" AS tenant_slug,
       coalesce(d."Name", 'Atanmamış') AS department,
       count(DISTINCT a."EmployeeId") AS headcount
FROM employee_assignments a
JOIN employee_employees e ON e."Id" = a."EmployeeId" AND e."Status" <> 'Terminated'
LEFT JOIN organization_departments d ON d."Id" = a."DepartmentId"
WHERE a."EffectiveFrom" <= current_date AND (a."EffectiveTo" IS NULL OR a."EffectiveTo" >= current_date)
GROUP BY 1, 2;

CREATE OR REPLACE VIEW analytics_overtime_monthly AS
SELECT "TenantSlug" AS tenant_slug,
       date_trunc('month', "Date")::date AS month,
       sum("WorkedMinutes") AS worked_minutes,
       sum("OvertimeMinutes") AS overtime_minutes
FROM timeshift_time_entries
GROUP BY 1, 2;

-- ==== 2026-10-03: scripts/sql/2026-10-03_chat_apps.sql ile ayni (ilk kurulum icin) ====
-- Slack uygulamasi / Microsoft Teams botu: kisiye ozel bildirim, onay dugmeleri, komutlar.
-- Idempotent; install.sh guncellemede otomatik uygular.

CREATE TABLE IF NOT EXISTS governance_chat_apps (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Platform" text NOT NULL,
    "Name" text NOT NULL,
    "IsEnabled" boolean NOT NULL DEFAULT true,
    "NotifyApprovals" boolean NOT NULL DEFAULT true,
    "NotifyRequesters" boolean NOT NULL DEFAULT true,
    "SlackTeamId" text,
    "SlackTeamName" text,
    "SlackBotUserId" text,
    "SlackBotTokenEnc" text,
    "SlackSigningSecretEnc" text,
    "TeamsAppId" text,
    "TeamsAppPasswordEnc" text,
    "TeamsAzureTenantId" text,
    "LastError" text,
    "LastActivityAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_governance_chat_apps_tenant ON governance_chat_apps ("TenantSlug");

CREATE TABLE IF NOT EXISTS governance_chat_identities (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "AppId" uuid NOT NULL REFERENCES governance_chat_apps ("Id") ON DELETE CASCADE,
    "Platform" text NOT NULL,
    "ExternalUserId" text NOT NULL,
    "EmployeeId" uuid,
    "Email" text,
    "DisplayName" text,
    "ConversationId" text,
    "ServiceUrl" text,
    "LinkedAt" timestamptz NOT NULL DEFAULT now(),
    "LastSeenAt" timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_governance_chat_identities_user ON governance_chat_identities ("AppId", "ExternalUserId");
CREATE INDEX IF NOT EXISTS ix_governance_chat_identities_employee ON governance_chat_identities ("TenantSlug", "EmployeeId");

CREATE TABLE IF NOT EXISTS governance_chat_messages (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "AppId" uuid NOT NULL REFERENCES governance_chat_apps ("Id") ON DELETE CASCADE,
    "Platform" text NOT NULL,
    "WorkflowRequestId" uuid NOT NULL,
    "StepId" uuid NOT NULL,
    "RecipientEmployeeId" uuid NOT NULL,
    "ConversationId" text NOT NULL,
    "MessageId" text NOT NULL,
    "ServiceUrl" text,
    "State" text NOT NULL DEFAULT 'Open',
    "Subject" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now(),
    "UpdatedAt" timestamptz
);
CREATE INDEX IF NOT EXISTS ix_governance_chat_messages_wf ON governance_chat_messages ("TenantSlug", "WorkflowRequestId");

-- ==== 2026-10-03: scripts/sql/2026-10-03_calendar_meetings.sql ile ayni (ilk kurulum icin) ====
-- Google / Microsoft 365 takvim baglantilari, Zoom / Teams / Google Meet toplantilari.
-- Idempotent; install.sh guncellemede otomatik uygular.

CREATE TABLE IF NOT EXISTS governance_provider_configs (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Provider" text NOT NULL,
    "ClientId" text NOT NULL,
    "ClientSecretEnc" text,
    "MsTenant" text,
    "ZoomAccountId" text,
    "ZoomDefaultHost" text,
    "IsEnabled" boolean NOT NULL DEFAULT true,
    "LastError" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_governance_provider_configs ON governance_provider_configs ("TenantSlug", "Provider");

CREATE TABLE IF NOT EXISTS governance_calendar_connections (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "UserId" text NOT NULL,
    "Provider" text NOT NULL,
    "AccountEmail" text,
    "AccessTokenEnc" text,
    "RefreshTokenEnc" text,
    "ExpiresAt" timestamptz,
    "SyncLeaves" boolean NOT NULL DEFAULT true,
    "Status" text NOT NULL DEFAULT 'Active',
    "LastError" text,
    "LastSyncAt" timestamptz,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_governance_calendar_connections ON governance_calendar_connections ("TenantSlug", "EmployeeId", "Provider");

CREATE TABLE IF NOT EXISTS governance_oauth_states (
    "State" text PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "UserId" text NOT NULL,
    "Provider" text NOT NULL,
    "CodeVerifier" text NOT NULL,
    "ExpiresAt" timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS governance_calendar_events (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "ConnectionId" uuid NOT NULL REFERENCES governance_calendar_connections ("Id") ON DELETE CASCADE,
    "SourceType" text NOT NULL,
    "SourceId" uuid NOT NULL,
    "ExternalEventId" text NOT NULL,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_governance_calendar_events_source ON governance_calendar_events ("TenantSlug", "SourceType", "SourceId");

CREATE TABLE IF NOT EXISTS governance_meetings (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "SourceType" text NOT NULL,
    "SourceId" uuid,
    "Title" text NOT NULL,
    "Description" text,
    "StartsAt" timestamptz NOT NULL,
    "DurationMinutes" integer NOT NULL,
    "Provider" text NOT NULL,
    "JoinUrl" text,
    "ExternalMeetingId" text,
    "OrganizerEmployeeId" uuid NOT NULL,
    "ParticipantEmployeeIds" uuid[] NOT NULL DEFAULT '{}',
    "ExternalEmails" text[] NOT NULL DEFAULT '{}',
    "Status" text NOT NULL DEFAULT 'Scheduled',
    "Warnings" text,
    "CreatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_governance_meetings_source ON governance_meetings ("TenantSlug", "SourceType", "SourceId");

-- ==== 2026-10-03: scripts/sql/2026-10-03_ai_llm.sql ile ayni (ilk kurulum icin) ====
-- Yapay zeka (LLM) kiraci ayari ve kullanim kaydi. Idempotent.

CREATE TABLE IF NOT EXISTS governance_ai_settings (
    "Id" uuid PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "Enabled" boolean NOT NULL DEFAULT false,
    "AllowPersonalData" boolean NOT NULL DEFAULT false,
    "UpdatedBy" text,
    "UpdatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_governance_ai_settings_tenant ON governance_ai_settings ("TenantSlug");

CREATE TABLE IF NOT EXISTS governance_ai_usage (
    "Id" bigserial PRIMARY KEY,
    "TenantSlug" character varying(64) NOT NULL,
    "UserId" text,
    "Task" text NOT NULL,
    "Provider" text NOT NULL,
    "Model" text NOT NULL,
    "InputTokens" integer NOT NULL DEFAULT 0,
    "OutputTokens" integer NOT NULL DEFAULT 0,
    "DurationMs" integer NOT NULL DEFAULT 0,
    "Success" boolean NOT NULL,
    "At" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_governance_ai_usage_tenant_at ON governance_ai_usage ("TenantSlug", "At");

-- 2026-10-03_notification_language.sql
-- Bildirim dili: çalışan tercihi ve her iletinin dili (e-posta çerçevesi de bu dilde).
ALTER TABLE notification_messages ADD COLUMN IF NOT EXISTS "Language" text NOT NULL DEFAULT 'tr';

CREATE TABLE IF NOT EXISTS notification_preferences (
    "TenantSlug" character varying(64) NOT NULL,
    "EmployeeId" uuid NOT NULL,
    "Language" text NOT NULL DEFAULT 'tr',
    "UpdatedAt" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("TenantSlug", "EmployeeId")
);
