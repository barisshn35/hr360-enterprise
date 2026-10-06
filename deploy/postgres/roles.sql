-- HR360 servis başına PostgreSQL rolleri ve yetkileri.
-- OTOMATİK ÜRETİLDİ: scripts/db-roles.sh generate (elle düzenlemeyin; kod değişince yeniden üretin).
-- İdempotent; parola İÇERMEZ (roller NOLOGIN oluşturulur; `scripts/db-roles.sh apply` LOGIN + parola verir).
-- Her rolün public şemasındaki tablo/dizi yetkileri önce geri alınır, sonra listeden yeniden verilir;
-- hepsi tek işlemde (çalışan servisler ara durumu görmez). Yeni tablolar (migration sonrası) için yeniden
-- üretip uygulayın: hr360admin'in varsayılan yetkileri (DEFAULT PRIVILEGES) bilerek açılmadı.
BEGIN;

-- ---------------------------------------------------------------- hr360_organization
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_organization') THEN CREATE ROLE hr360_organization NOLOGIN; END IF; END $$;
ALTER ROLE hr360_organization NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_organization;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_organization;
REVOKE CREATE ON SCHEMA public FROM hr360_organization;
GRANT USAGE ON SCHEMA public TO hr360_organization;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['organization_companies', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_department_links', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_departments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_team_members', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_teams', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_organization', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_organization', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_organization', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_employee
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_employee') THEN CREATE ROLE hr360_employee NOLOGIN; END IF; END $$;
ALTER ROLE hr360_employee NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_employee;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_employee;
REVOKE CREATE ON SCHEMA public FROM hr360_employee;
GRANT USAGE ON SCHEMA public TO hr360_employee;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['employee_employees', 'SELECT, INSERT, UPDATE, DELETE'],
    ['messaging_outbox', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_employee', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_employee', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_employee', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_workflow
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_workflow') THEN CREATE ROLE hr360_workflow NOLOGIN; END IF; END $$;
ALTER ROLE hr360_workflow NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_workflow;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_workflow;
REVOKE CREATE ON SCHEMA public FROM hr360_workflow;
GRANT USAGE ON SCHEMA public TO hr360_workflow;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['leave_balances', 'SELECT'],
    ['leave_requests', 'SELECT'],
    ['messaging_outbox', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['workflow_approval_steps', 'SELECT, INSERT, UPDATE, DELETE'],
    ['workflow_definitions', 'SELECT, INSERT, UPDATE, DELETE'],
    ['workflow_delegations', 'SELECT, INSERT, UPDATE, DELETE'],
    ['workflow_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['workflow_settings', 'SELECT, INSERT, UPDATE, DELETE']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_workflow', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_workflow', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_workflow', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_leave
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_leave') THEN CREATE ROLE hr360_leave NOLOGIN; END IF; END $$;
ALTER ROLE hr360_leave NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_leave;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_leave;
REVOKE CREATE ON SCHEMA public FROM hr360_leave;
GRANT USAGE ON SCHEMA public TO hr360_leave;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['engagement_profiles', 'SELECT'],
    ['leave_balances', 'SELECT, INSERT, UPDATE, DELETE'],
    ['leave_public_holidays', 'SELECT, INSERT, UPDATE, DELETE'],
    ['leave_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['leave_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['messaging_outbox', 'SELECT, INSERT, UPDATE, DELETE'],
    ['messaging_processed_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_leave', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_leave', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_leave', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_recruitment
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_recruitment') THEN CREATE ROLE hr360_recruitment NOLOGIN; END IF; END $$;
ALTER ROLE hr360_recruitment NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_recruitment;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_recruitment;
REVOKE CREATE ON SCHEMA public FROM hr360_recruitment;
GRANT USAGE ON SCHEMA public TO hr360_recruitment;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_employees', 'SELECT'],
    ['governance_destruction_logs', 'SELECT, INSERT'],
    ['messaging_processed_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_messages', 'SELECT, INSERT'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['recruitment_applications', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_candidates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_interviews', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_job_postings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_offer_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_offers', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_scorecard_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['recruitment_scorecards', 'SELECT, INSERT, UPDATE, DELETE']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_recruitment', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_recruitment', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_recruitment', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_onboarding
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_onboarding') THEN CREATE ROLE hr360_onboarding NOLOGIN; END IF; END $$;
ALTER ROLE hr360_onboarding NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_onboarding;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_onboarding;
REVOKE CREATE ON SCHEMA public FROM hr360_onboarding;
GRANT USAGE ON SCHEMA public TO hr360_onboarding;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['notification_messages', 'SELECT, INSERT'],
    ['onboarding_asset_assignments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_asset_maintenance', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_assets', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_plans', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_task_template_items', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_task_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['onboarding_tasks', 'SELECT, INSERT, UPDATE, DELETE'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_onboarding', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_onboarding', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_onboarding', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_timeshift
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_timeshift') THEN CREATE ROLE hr360_timeshift NOLOGIN; END IF; END $$;
ALTER ROLE hr360_timeshift NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_timeshift;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_timeshift;
REVOKE CREATE ON SCHEMA public FROM hr360_timeshift;
GRANT USAGE ON SCHEMA public TO hr360_timeshift;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['messaging_processed_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_messages', 'SELECT, INSERT'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['timeshift_assignments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_clock_credentials', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_clock_punches', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_clock_sites', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_overtime_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_overrides', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_pattern_days', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_patterns', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_preferences', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_team_members', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shift_teams', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_shifts', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_swap_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_time_entries', 'SELECT, INSERT, UPDATE, DELETE'],
    ['timeshift_timesheet_periods', 'SELECT, INSERT, UPDATE, DELETE']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_timeshift', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_timeshift', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_timeshift', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_performance
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_performance') THEN CREATE ROLE hr360_performance NOLOGIN; END IF; END $$;
ALTER ROLE hr360_performance NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_performance;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_performance;
REVOKE CREATE ON SCHEMA public FROM hr360_performance;
GRANT USAGE ON SCHEMA public TO hr360_performance;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['organization_departments', 'SELECT'],
    ['performance_cycle_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_cycles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_feedback', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_goals', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_metrics', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_ninebox_overrides', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_potential_ratings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_review_scores', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_reviews', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_scoring_config', 'SELECT, INSERT, UPDATE, DELETE'],
    ['performance_snapshots', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_performance', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_performance', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_performance', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_learning
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_learning') THEN CREATE ROLE hr360_learning NOLOGIN; END IF; END $$;
ALTER ROLE hr360_learning NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_learning;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_learning;
REVOKE CREATE ON SCHEMA public FROM hr360_learning;
GRANT USAGE ON SCHEMA public TO hr360_learning;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['learning_cert_reminders', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_certifications', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_competencies', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_competency_assessments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_course_competencies', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_course_modules', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_courses', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_enrollments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_module_progress', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_quiz_attempts', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_quiz_questions', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_role_profiles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_scorm_files', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_scorm_packages', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_scorm_runtime', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_messages', 'SELECT, INSERT'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_learning', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_learning', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_learning', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_engagement
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_engagement') THEN CREATE ROLE hr360_engagement NOLOGIN; END IF; END $$;
ALTER ROLE hr360_engagement NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_engagement;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_engagement;
REVOKE CREATE ON SCHEMA public FROM hr360_engagement;
GRANT USAGE ON SCHEMA public TO hr360_engagement;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['compensation_payroll_parameters', 'SELECT'],
    ['compensation_records', 'SELECT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['engagement_desk_bookings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_desks', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_internal_applications', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_kudos', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_mentor_profiles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_mentorships', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_offboarding_cases', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_one_on_ones', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_org_scenarios', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_presence', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_profiles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_succession_plans', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_survey_responses', 'SELECT, INSERT, UPDATE, DELETE'],
    ['engagement_surveys', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_field_policies', 'SELECT'],
    ['governance_retention_policies', 'SELECT'],
    ['governance_security_alerts', 'SELECT'],
    ['leave_balances', 'SELECT'],
    ['leave_requests', 'SELECT'],
    ['notification_messages', 'SELECT, INSERT'],
    ['onboarding_asset_assignments', 'SELECT'],
    ['onboarding_assets', 'SELECT'],
    ['organization_departments', 'SELECT'],
    ['organization_team_members', 'SELECT'],
    ['organization_teams', 'SELECT'],
    ['performance_snapshots', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['recruitment_job_postings', 'SELECT'],
    ['timeshift_time_entries', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_engagement', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_engagement', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_engagement', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_governance
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_governance') THEN CREATE ROLE hr360_governance NOLOGIN; END IF; END $$;
ALTER ROLE hr360_governance NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_governance;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_governance;
REVOKE CREATE ON SCHEMA public FROM hr360_governance;
GRANT USAGE ON SCHEMA public TO hr360_governance;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['analytics_department_headcount', 'SELECT'],
    ['analytics_leave_monthly', 'SELECT'],
    ['analytics_overtime_monthly', 'SELECT'],
    ['audit_log', 'SELECT, INSERT'],
    ['compensation_payroll_periods', 'SELECT'],
    ['compensation_payslips', 'SELECT, DELETE'],
    ['compensation_records', 'SELECT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT, UPDATE'],
    ['engagement_desk_bookings', 'SELECT'],
    ['engagement_desks', 'SELECT'],
    ['engagement_kudos', 'SELECT, UPDATE'],
    ['engagement_offboarding_cases', 'SELECT'],
    ['engagement_one_on_ones', 'SELECT'],
    ['engagement_presence', 'SELECT'],
    ['engagement_profiles', 'SELECT, UPDATE'],
    ['engagement_survey_responses', 'SELECT'],
    ['engagement_surveys', 'SELECT'],
    ['expense_claims', 'SELECT'],
    ['governance_access_review_items', 'SELECT, INSERT, UPDATE'],
    ['governance_access_reviews', 'SELECT, INSERT, UPDATE'],
    ['governance_acknowledgements', 'SELECT, INSERT, DELETE'],
    ['governance_ai_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_ai_usage', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_analysis_objections', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_announcements', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_api_keys', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_audit_anchors', 'SELECT, INSERT, DELETE'],
    ['governance_calendar_connections', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_calendar_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_calendar_feeds', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_apps', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_context', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_errors', 'SELECT, INSERT, DELETE'],
    ['governance_chat_exit_progress', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_identities', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_job_log', 'SELECT, INSERT, DELETE'],
    ['governance_chat_messages', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_optins', 'SELECT, INSERT, UPDATE'],
    ['governance_chat_outbox', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_pending', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_chat_pulse_answered', 'SELECT, INSERT, DELETE'],
    ['governance_chat_pulses', 'SELECT, INSERT, UPDATE'],
    ['governance_chat_usage', 'SELECT, INSERT, UPDATE'],
    ['governance_consents', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_custom_field_values', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_custom_fields', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_data_breaches', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_data_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_destruction_logs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_disciplinary_cases', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_doc_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_document_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_ethics_committee', 'SELECT, INSERT, DELETE'],
    ['governance_ethics_messages', 'SELECT, INSERT'],
    ['governance_ethics_reports', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_field_policies', 'SELECT, INSERT, UPDATE'],
    ['governance_integrations', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_invoices', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_kb_articles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_library_documents', 'SELECT, INSERT, UPDATE'],
    ['governance_library_versions', 'SELECT, INSERT'],
    ['governance_meetings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_ml_fairness_reports', 'SELECT, INSERT'],
    ['governance_ml_model_settings', 'SELECT, INSERT, UPDATE'],
    ['governance_oauth_states', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_osh_exams', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_osh_incidents', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_osh_trainings', 'SELECT, INSERT, DELETE'],
    ['governance_privacy_assessments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_privacy_notices', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_provider_configs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_retention_policies', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_rule_runs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_rules', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_saved_reports', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_security_alerts', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_security_settings', 'SELECT, INSERT, UPDATE'],
    ['governance_siem_cursor', 'SELECT, INSERT, UPDATE'],
    ['governance_signature_otps', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_signatures', 'SELECT, INSERT, DELETE'],
    ['governance_transfer_agreements', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_webhook_deliveries', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_webhooks', 'SELECT, INSERT, UPDATE, DELETE'],
    ['learning_certifications', 'SELECT'],
    ['learning_competencies', 'SELECT'],
    ['learning_competency_assessments', 'SELECT'],
    ['learning_courses', 'SELECT'],
    ['learning_enrollments', 'SELECT'],
    ['leave_balances', 'SELECT'],
    ['leave_public_holidays', 'SELECT'],
    ['leave_requests', 'SELECT'],
    ['notification_messages', 'SELECT, INSERT, DELETE'],
    ['notification_preferences', 'SELECT, INSERT, UPDATE'],
    ['onboarding_asset_assignments', 'SELECT'],
    ['onboarding_plans', 'SELECT'],
    ['onboarding_tasks', 'SELECT'],
    ['organization_departments', 'SELECT'],
    ['organization_team_members', 'SELECT'],
    ['organization_teams', 'SELECT'],
    ['performance_goals', 'SELECT'],
    ['performance_reviews', 'SELECT'],
    ['performance_snapshots', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['recruitment_applications', 'SELECT'],
    ['recruitment_candidates', 'SELECT, UPDATE, DELETE'],
    ['recruitment_interviews', 'SELECT'],
    ['recruitment_job_postings', 'SELECT'],
    ['recruitment_offers', 'SELECT'],
    ['timeshift_assignments', 'SELECT'],
    ['timeshift_shifts', 'SELECT'],
    ['timeshift_swap_requests', 'SELECT'],
    ['timeshift_time_entries', 'SELECT'],
    ['workflow_approval_steps', 'SELECT'],
    ['workflow_requests', 'SELECT'],
    ['workflow_settings', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_governance', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_governance', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_governance', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_compensation
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_compensation') THEN CREATE ROLE hr360_compensation NOLOGIN; END IF; END $$;
ALTER ROLE hr360_compensation NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_compensation;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_compensation;
REVOKE CREATE ON SCHEMA public FROM hr360_compensation;
GRANT USAGE ON SCHEMA public TO hr360_compensation;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['compensation_advances', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_benefit_elections', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_benefit_options', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_benefit_plans', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_employee_sgk', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payroll_adjustments', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payroll_exports', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payroll_parameters', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payroll_periods', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payroll_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payslip_deliveries', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_payslips', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_raise_cycles', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_raise_proposals', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_records', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_retro_diffs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_salary_bands', 'SELECT, INSERT, UPDATE, DELETE'],
    ['compensation_severance_calcs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['engagement_offboarding_cases', 'SELECT'],
    ['engagement_profiles', 'SELECT'],
    ['governance_doc_templates', 'SELECT'],
    ['governance_security_settings', 'SELECT'],
    ['leave_balances', 'SELECT'],
    ['leave_requests', 'SELECT'],
    ['notification_messages', 'SELECT, INSERT'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT'],
    ['timeshift_overtime_requests', 'SELECT'],
    ['timeshift_timesheet_periods', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_compensation', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_compensation', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_compensation', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_expense
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_expense') THEN CREATE ROLE hr360_expense NOLOGIN; END IF; END $$;
ALTER ROLE hr360_expense NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_expense;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_expense;
REVOKE CREATE ON SCHEMA public FROM hr360_expense;
GRANT USAGE ON SCHEMA public TO hr360_expense;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_assignments', 'SELECT'],
    ['employee_employees', 'SELECT'],
    ['expense_claims', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_document_signatures', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_documents', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_fx_rates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_hr_cases', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_items', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_policies', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_signature_evidence', 'SELECT, INSERT, UPDATE, DELETE'],
    ['expense_travel_requests', 'SELECT, INSERT, UPDATE, DELETE'],
    ['governance_signature_otps', 'SELECT, DELETE'],
    ['governance_signatures', 'SELECT, DELETE'],
    ['messaging_outbox', 'SELECT, INSERT, UPDATE, DELETE'],
    ['messaging_processed_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_messages', 'SELECT, INSERT'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_expense', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_expense', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_expense', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_notification
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_notification') THEN CREATE ROLE hr360_notification NOLOGIN; END IF; END $$;
ALTER ROLE hr360_notification NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_notification;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_notification;
REVOKE CREATE ON SCHEMA public FROM hr360_notification;
GRANT USAGE ON SCHEMA public TO hr360_notification;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['messaging_processed_events', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_category_prefs', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_messages', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_preferences', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_push_subscriptions', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_templates', 'SELECT, INSERT, UPDATE, DELETE'],
    ['notification_vapid_keys', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_access_grants', 'SELECT'],
    ['platform_tenants', 'SELECT']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_notification', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_notification', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_notification', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_tenant
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_tenant') THEN CREATE ROLE hr360_tenant NOLOGIN; END IF; END $$;
ALTER ROLE hr360_tenant NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_tenant;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_tenant;
REVOKE CREATE ON SCHEMA public FROM hr360_tenant;
GRANT USAGE ON SCHEMA public TO hr360_tenant;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, INSERT'],
    ['employee_employees', 'SELECT'],
    ['organization_companies', 'SELECT, INSERT, DELETE'],
    ['organization_departments', 'SELECT'],
    ['platform_access_grants', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_tenant_provisioning_log', 'SELECT, INSERT, UPDATE, DELETE'],
    ['platform_tenants', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_custom_domains', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_directory_settings', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_directory_users', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_login_networks', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_scim_tokens', 'SELECT, INSERT, UPDATE, DELETE'],
    ['tenant_security_alerts', 'SELECT, INSERT, DELETE']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_tenant', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_tenant', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_tenant', s);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- hr360_retention
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hr360_retention') THEN CREATE ROLE hr360_retention NOLOGIN; END IF; END $$;
ALTER ROLE hr360_retention NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hr360_retention;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM hr360_retention;
REVOKE CREATE ON SCHEMA public FROM hr360_retention;
GRANT USAGE ON SCHEMA public TO hr360_retention;
DO $$ DECLARE g text[]; BEGIN
  FOREACH g SLICE 1 IN ARRAY ARRAY[
    ['audit_log', 'SELECT, DELETE']
  ]::text[] LOOP
    IF to_regclass('public.' || quote_ident(g[1])) IS NOT NULL THEN
      EXECUTE format('GRANT %s ON TABLE public.%I TO hr360_retention', g[2], g[1]);
    END IF;
  END LOOP;
END $$;
DO $$ DECLARE s text; BEGIN
  FOR s IN SELECT DISTINCT seq.oid::regclass::text FROM pg_class seq
      JOIN pg_depend d ON d.objid = seq.oid AND d.deptype IN ('a', 'i')
      JOIN pg_class t ON t.oid = d.refobjid
     WHERE seq.relkind = 'S' AND has_table_privilege('hr360_retention', t.oid, 'INSERT') LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO hr360_retention', s);
  END LOOP;
END $$;

COMMIT;
