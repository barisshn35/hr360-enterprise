import { Suspense, lazy, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { AuthProvider } from '@/auth/AuthProvider'
import { RequireAuth } from '@/auth/RequireAuth'
import { RequirePermission } from '@/auth/RequirePermission'
import type { Permission, Role } from '@/auth/roles'
import { AppShell } from '@/components/layout/AppShell'
import { ToastProvider } from '@/components/ui/Toast'
import { CenteredSpinner, FullPageSpinner } from '@/components/ui/States'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { NotFoundPage } from '@/features/NotFoundPage'
import { PlanGate } from '@/features/shared/FeatureGate'

/**
 * Adlandırılmış dışa aktarımı olan sayfaları tembel yükler.
 * Her modül kendi chunk'ında kalsın: ilk yükleme paketi küçük olur, panele
 * hiç girmeyen ziyaretçi 14 modülün kodunu indirmez.
 */
function page<N extends string>(
  loader: () => Promise<Record<N, ComponentType>>,
  name: N,
) {
  return lazy(async () => ({ default: (await loader())[name] }))
}

const SignInPage = page(() => import('@/features/auth/SignInPage'), 'SignInPage')
const RegisterCompanyWizard = page(
  () => import('@/features/registration/RegisterCompanyWizard'),
  'RegisterCompanyWizard',
)

const WorkflowInboxPage = page(() => import('@/features/workflows/WorkflowInboxPage'), 'WorkflowInboxPage')
const WorkflowDetailPage = page(() => import('@/features/workflows/WorkflowDetailPage'), 'WorkflowDetailPage')
const LeavePage = page(() => import('@/features/leave/LeavePage'), 'LeavePage')
const ExpensePage = page(() => import('@/features/expense/ExpensePage'), 'ExpensePage')
const ExpenseClaimPage = page(() => import('@/features/expense/ExpenseClaimPage'), 'ExpenseClaimPage')
const CasesPage = page(() => import('@/features/cases/CasesPage'), 'CasesPage')
const CaseDetailPage = page(() => import('@/features/cases/CaseDetailPage'), 'CaseDetailPage')
const TimesheetPage = page(() => import('@/features/timeshift/TimesheetPage'), 'TimesheetPage')
const ShiftEnginePage = page(() => import('@/features/timeshift/engine/ShiftEnginePage'), 'ShiftEnginePage')
const OrganizationPage = page(() => import('@/features/organization/OrganizationPage'), 'OrganizationPage')
const CompanyDetailPage = page(() => import('@/features/organization/CompanyDetailPage'), 'CompanyDetailPage')
const EmployeeListPage = page(() => import('@/features/employees/EmployeeListPage'), 'EmployeeListPage')
const EmployeeDetailPage = page(() => import('@/features/employees/EmployeeDetailPage'), 'EmployeeDetailPage')
const JobPostingsPage = page(() => import('@/features/recruitment/JobPostingsPage'), 'JobPostingsPage')
const JobPostingDetailPage = page(() => import('@/features/recruitment/JobPostingDetailPage'), 'JobPostingDetailPage')
const CandidatesPage = page(() => import('@/features/recruitment/CandidatesPage'), 'CandidatesPage')
const OnboardingPage = page(() => import('@/features/onboarding/OnboardingPage'), 'OnboardingPage')
const OnboardingPlanPage = page(() => import('@/features/onboarding/OnboardingPlanPage'), 'OnboardingPlanPage')
const AssetsPage = page(() => import('@/features/onboarding/AssetsPage'), 'AssetsPage')
const PerformanceIndex = page(() => import('@/features/performance/PerformanceIndex'), 'PerformanceIndex')
const MetricsPage = page(() => import('@/features/performance/metrics/MetricsPage'), 'MetricsPage')
const TeamsPage = page(() => import('@/features/performance/teams/TeamsPage'), 'TeamsPage')
const CyclesPage = page(() => import('@/features/performance/cycles/CyclesPage'), 'CyclesPage')
const GoalsPage = page(() => import('@/features/performance/goals/GoalsPage'), 'GoalsPage')
const ReviewsPage = page(() => import('@/features/performance/reviews/ReviewsPage'), 'ReviewsPage')
const NewReviewPage = page(() => import('@/features/performance/reviews/NewReviewPage'), 'NewReviewPage')
const ReviewFormPage = page(() => import('@/features/performance/reviews/ReviewFormPage'), 'ReviewFormPage')
const ScorePage = page(() => import('@/features/performance/score/ScorePage'), 'ScorePage')
const AnalyticsPage = page(() => import('@/features/performance/analytics/AnalyticsPage'), 'AnalyticsPage')
const FeedbackPage = page(() => import('@/features/performance/feedback/FeedbackPage'), 'FeedbackPage')
const RecommendationsPage = page(() => import('@/features/performance/recommendations/RecommendationsPage'), 'RecommendationsPage')
const MyPerformancePage = page(() => import('@/features/performance/me/MyPerformancePage'), 'MyPerformancePage')
const ScoringSettingsPage = page(() => import('@/features/performance/settings/ScoringSettingsPage'), 'ScoringSettingsPage')
const LearningPage = page(() => import('@/features/learning/LearningPage'), 'LearningPage')
const CompensationPage = page(() => import('@/features/compensation/CompensationPage'), 'CompensationPage')
const DocumentsPage = page(() => import('@/features/documents/DocumentsPage'), 'DocumentsPage')
const NotificationsPage = page(() => import('@/features/notification/NotificationsPage'), 'NotificationsPage')
const SettingsPage = page(() => import('@/features/settings/SettingsPage'), 'SettingsPage')
const RolesPage = page(() => import('@/features/settings/RolesPage'), 'RolesPage')
const TenantsPage = page(() => import('@/features/platform/TenantsPage'), 'TenantsPage')

/* -------- Topluluk, gelişim, kişiler, içgörü, yönetişim (2026-10 eklemeleri) -------- */
const ProfilePage = page(() => import('@/features/profile/ProfilePage'), 'ProfilePage')
const KudosPage = page(() => import('@/features/community/KudosPage'), 'KudosPage')
const CelebrationsPage = page(() => import('@/features/community/CelebrationsPage'), 'CelebrationsPage')
const SurveysPage = page(() => import('@/features/community/SurveysPage'), 'SurveysPage')
const DirectoryPage = page(() => import('@/features/community/DirectoryPage'), 'DirectoryPage')
const WorkplacePage = page(() => import('@/features/workplace/WorkplacePage'), 'WorkplacePage')
const MentorshipPage = page(() => import('@/features/growth/MentorshipPage'), 'MentorshipPage')
const MobilityPage = page(() => import('@/features/growth/MobilityPage'), 'MobilityPage')
const OneOnOnesPage = page(() => import('@/features/growth/OneOnOnesPage'), 'OneOnOnesPage')
const TeamHealthPage = page(() => import('@/features/growth/TeamHealthPage'), 'TeamHealthPage')
const OffboardingPage = page(() => import('@/features/people/OffboardingPage'), 'OffboardingPage')
const SuccessionPage = page(() => import('@/features/people/SuccessionPage'), 'SuccessionPage')
const OrgScenariosPage = page(() => import('@/features/people/OrgScenariosPage'), 'OrgScenariosPage')
const HireSagaPage = page(() => import('@/features/people/HireSagaPage'), 'HireSagaPage')
const InsightsAnalyticsPage = page(() => import('@/features/insights/AnalyticsPage'), 'AnalyticsPage')
const NlReportPage = page(() => import('@/features/insights/NlReportPage'), 'NlReportPage')
const TimeMachinePage = page(() => import('@/features/insights/TimeMachinePage'), 'TimeMachinePage')
const EventRadarPage = page(() => import('@/features/insights/EventRadarPage'), 'EventRadarPage')
const AiToolsPage = page(() => import('@/features/insights/AiToolsPage'), 'AiToolsPage')
const PayrollSimPage = page(() => import('@/features/insights/PayrollSimPage'), 'PayrollSimPage')
const AuditPage = page(() => import('@/features/governance/AuditPage'), 'AuditPage')
const PrivacyAdminPage = page(() => import('@/features/governance/PrivacyAdminPage'), 'PrivacyAdminPage')
const DocTemplatesPage = page(() => import('@/features/governance/DocTemplatesPage'), 'DocTemplatesPage')
const RulesPage = page(() => import('@/features/governance/RulesPage'), 'RulesPage')
const IntegrationsPage = page(() => import('@/features/governance/IntegrationsPage'), 'IntegrationsPage')
const SecurityPage = page(() => import('@/features/governance/SecurityPage'), 'SecurityPage')
const ImportExportPage = page(() => import('@/features/governance/ImportExportPage'), 'ImportExportPage')
const BillingPage = page(() => import('@/features/governance/BillingPage'), 'BillingPage')
const PlatformInvoicesPage = page(() => import('@/features/governance/BillingPage'), 'PlatformInvoicesPage')
const OrgPresentationPage = page(() => import('@/features/organization/OrgPresentationPage'), 'OrgPresentationPage')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Yetki/bulunamadı hatalarında yeniden denemek anlamsız.
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) return false
        return failureCount < 2
      },
    },
  },
})

/** Rota tanımlarını kısaltır; izin kontrolü tek kapıdan geçer. */
function guarded(permission: Permission, element: ReactNode, requireRoles?: Role[]) {
  return (
    <RequirePermission permission={permission} requireRoles={requireRoles}>
      {element}
    </RequirePermission>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                {/* ------------------------------ Herkese açık ------------------------------ */}
                {/* Ayrı bir tanıtım/ana sayfası yok — kök adres doğrudan girişe yönlenir. */}
                <Route path="/" element={<Navigate to="/giris" replace />} />
                <Route
                  path="/giris"
                  element={
                    <Suspense fallback={<FullPageSpinner />}>
                      <SignInPage />
                    </Suspense>
                  }
                />
                {/* Şirket kaydı ANONİM: token gerekmez, RequireAuth yok. */}
                <Route
                  path="/kayit"
                  element={
                    <Suspense fallback={<FullPageSpinner />}>
                      <RegisterCompanyWizard />
                    </Suspense>
                  }
                />

                {/* --------------------------- Oturum gerektiren --------------------------- */}
                <Route
                  path="/panel"
                  element={
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  }
                >
                  <Route
                    element={
                      <Suspense fallback={<CenteredSpinner />}>
                        <Outlet />
                      </Suspense>
                    }
                  >
                    <Route index element={<DashboardPage />} />

                    <Route path="onaylar" element={guarded('workflow:view', <WorkflowInboxPage />)} />
                    <Route
                      path="onaylar/:workflowId"
                      element={guarded('workflow:view', <WorkflowDetailPage />)}
                    />

                    <Route path="izin" element={guarded('leave:view', <LeavePage />)} />

                    <Route path="masraf" element={guarded('expense:view', <ExpensePage />)} />
                    <Route
                      path="masraf/:claimId"
                      element={guarded('expense:view', <ExpenseClaimPage />)}
                    />

                    <Route path="ik-vakalari" element={guarded('case:view', <CasesPage />)} />
                    <Route
                      path="ik-vakalari/:caseId"
                      element={guarded('case:view', <CaseDetailPage />)}
                    />

                    <Route path="puantaj" element={guarded('timeshift:view', <TimesheetPage />)} />
                    <Route
                      path="vardiya-motoru"
                      element={guarded('timeshift:view', <ShiftEnginePage />)}
                    />

                    <Route
                      path="organizasyon"
                      element={guarded('organization:view', <OrganizationPage />)}
                    />
                    {/* Diyagram herkese açık; yönetim görünümü sayfa içinde team:manage ile açılır. */}
                    <Route
                      path="organizasyon/ekipler"
                      element={guarded('organization:view', <TeamsPage />)}
                    />
                    <Route
                      path="organizasyon/:companyId"
                      element={guarded('organization:view', <CompanyDetailPage />)}
                    />

                    <Route
                      path="calisanlar"
                      element={guarded('employee:viewAll', <EmployeeListPage />)}
                    />
                    <Route
                      path="calisanlar/:employeeId"
                      element={guarded('employee:viewAll', <EmployeeDetailPage />)}
                    />

                    {/* "adaylar" ilan kimliğinden ÖNCE eşleşmeli */}
                    <Route path="ise-alim" element={guarded('recruitment:view', <JobPostingsPage />)} />
                    <Route
                      path="ise-alim/adaylar"
                      element={guarded('recruitment:view', <CandidatesPage />)}
                    />
                    <Route
                      path="ise-alim/:postingId"
                      element={guarded('recruitment:view', <JobPostingDetailPage />)}
                    />

                    <Route path="onboarding" element={guarded('onboarding:view', <OnboardingPage />)} />
                    <Route
                      path="onboarding/:planId"
                      element={guarded('onboarding:view', <OnboardingPlanPage />)}
                    />
                    <Route path="zimmet" element={guarded('onboarding:view', <AssetsPage />)} />

                    {/* ------------------------------ Performans ------------------------------ */}
                    <Route path="performans" element={guarded('performance:view', <PerformanceIndex />)} />
                    <Route
                      path="performans/metrikler"
                      element={guarded('performance:manage', <MetricsPage />)}
                    />
                    <Route
                      path="performans/ayarlar"
                      element={guarded('performance:manage', <ScoringSettingsPage />)}
                    />
                    <Route
                      path="performans/donemler"
                      element={guarded('performance:manage', <CyclesPage />)}
                    />
                    <Route path="performans/hedefler" element={guarded('performance:view', <GoalsPage />)} />
                    <Route path="performans/degerlendirme" element={guarded('performance:view', <ReviewsPage />)} />
                    <Route path="performans/degerlendirme/yeni" element={guarded('performance:view', <NewReviewPage />)} />
                    <Route path="performans/degerlendirme/:reviewId" element={guarded('performance:view', <ReviewFormPage />)} />
                    <Route path="performans/puan" element={guarded('performance:view', <ScorePage />)} />
                    <Route path="performans/analiz" element={guarded('performance:manage', <AnalyticsPage />)} />
                    <Route path="performans/geri-bildirim" element={guarded('performance:view', <FeedbackPage />)} />
                    <Route path="performans/oneriler" element={guarded('performance:manage', <RecommendationsPage />)} />
                    <Route path="performans/benim" element={guarded('performance:view', <MyPerformancePage />)} />

                    <Route path="egitim" element={guarded('learning:view', <LearningPage />)} />

                    {/* Ücret hassas veri — yalnızca İK yönetimi */}
                    <Route path="ucret" element={guarded('compensation:view', <CompensationPage />)} />

                    <Route path="dokumanlar" element={guarded('document:manage', <DocumentsPage />)} />
                    <Route
                      path="bildirimler"
                      element={guarded('notification:view', <NotificationsPage />)}
                    />
                    <Route path="ayarlar" element={<SettingsPage />} />
                    {/* Rol atama backend'de RequireHrAdmin gerektirir (bkz.
                        TeamMembersController.AssignRole) - aynı izinle koru.
                        requireRoles: bu sayfanın veri uçları (GetAll members
                        dahil) tenant-service'in KENDİ RequireHrAdmin
                        policy'sini kullanıyor - bilerek "ext-*" ile
                        genişletilmedi (rol atama gücünün Ek İzin ile
                        devredilmesi istenmiyor). employee:manage Ek İznini
                        alan biri, can('employee:manage') ile buraya girip
                        veri çekemezdi (403) - requireRoles bunu, backend'in
                        gerçekte kabul ettiği sabit rollerle eşleştirerek
                        önlüyor. */}
                    <Route
                      path="roller"
                      element={guarded('employee:manage', <RolesPage />, [
                        'hr-admin',
                        'tenant-admin',
                        'platform-admin',
                      ])}
                    />

                    {/* Platform yönetimi — çok kiracılılık */}
                    <Route
                      path="platform/kiracilar"
                      element={guarded('platform:manage', <TenantsPage />)}
                    />

                    {/* ---------------- Hesabım ---------------- */}
                    <Route path="profil" element={<ProfilePage />} />

                    {/* ---------------- Topluluk ---------------- */}
                    <Route path="takdir" element={<PlanGate feature="kudos"><KudosPage /></PlanGate>} />
                    <Route path="kutlamalar" element={<PlanGate feature="celebrations"><CelebrationsPage /></PlanGate>} />
                    <Route path="anketler" element={<PlanGate feature="surveys"><SurveysPage /></PlanGate>} />
                    <Route path="yetenek-dizini" element={<PlanGate feature="profile"><DirectoryPage /></PlanGate>} />
                    <Route path="ofis" element={<PlanGate feature="workplace"><WorkplacePage /></PlanGate>} />
                    <Route path="bordro-simulasyonu" element={<PlanGate feature="payroll-sim"><PayrollSimPage /></PlanGate>} />

                    {/* ---------------- Gelişim ---------------- */}
                    <Route path="mentorluk" element={<PlanGate feature="mentorship"><MentorshipPage /></PlanGate>} />
                    <Route path="ic-ilanlar" element={<PlanGate feature="mobility"><MobilityPage /></PlanGate>} />
                    <Route path="birebir" element={<PlanGate feature="one-on-ones"><OneOnOnesPage /></PlanGate>} />
                    <Route path="ekip-sagligi" element={guarded('performance:manage', <PlanGate feature="team-health"><TeamHealthPage /></PlanGate>)} />

                    {/* ---------------- Kişiler ---------------- */}
                    <Route path="offboarding" element={guarded('onboarding:manage', <PlanGate feature="offboarding"><OffboardingPage /></PlanGate>)} />
                    <Route path="ardil-planlama" element={guarded('performance:manage', <PlanGate feature="succession"><SuccessionPage /></PlanGate>)} />
                    <Route path="org-senaryolari" element={guarded('performance:manage', <PlanGate feature="org-scenarios"><OrgScenariosPage /></PlanGate>)} />
                    <Route path="ise-alim/saga" element={guarded('recruitment:view', <PlanGate feature="sagas"><HireSagaPage /></PlanGate>, ['hr-admin', 'tenant-admin', 'platform-admin'])} />
                    <Route path="organizasyon/sunum" element={guarded('organization:view', <PlanGate feature="profile"><OrgPresentationPage /></PlanGate>)} />

                    {/* ---------------- İçgörü ---------------- */}
                    <Route path="analitik" element={guarded('performance:manage', <PlanGate feature="analytics"><InsightsAnalyticsPage /></PlanGate>)} />
                    <Route path="rapor-asistani" element={guarded('performance:manage', <PlanGate feature="nl-report"><NlReportPage /></PlanGate>)} />
                    <Route path="zaman-makinesi" element={guarded('performance:manage', <PlanGate feature="time-machine"><TimeMachinePage /></PlanGate>)} />
                    <Route path="olay-radari" element={guarded('performance:manage', <PlanGate feature="events"><EventRadarPage /></PlanGate>)} />
                    <Route path="ai-araclari" element={guarded('recruitment:view', <PlanGate feature="ai-tools"><AiToolsPage /></PlanGate>)} />

                    {/* ---------------- Yönetişim ---------------- */}
                    <Route path="denetim" element={guarded('employee:manage', <PlanGate feature="audit"><AuditPage /></PlanGate>)} />
                    <Route path="kvkk" element={guarded('employee:manage', <PlanGate feature="privacy"><PrivacyAdminPage /></PlanGate>)} />
                    <Route path="belge-sablonlari" element={guarded('document:manage', <PlanGate feature="documents"><DocTemplatesPage /></PlanGate>)} />
                    <Route path="kural-motoru" element={guarded('employee:manage', <PlanGate feature="rules"><RulesPage /></PlanGate>)} />
                    <Route path="entegrasyonlar" element={guarded('employee:manage', <PlanGate feature="webhooks"><IntegrationsPage /></PlanGate>)} />
                    <Route path="guvenlik" element={guarded('tenant:manage', <PlanGate feature="sso"><SecurityPage /></PlanGate>, ['tenant-admin', 'platform-admin'])} />
                    <Route path="ice-disa-aktarim" element={guarded('employee:manage', <PlanGate feature="import-export"><ImportExportPage /></PlanGate>)} />
                    <Route path="abonelik" element={guarded('tenant:manage', <PlanGate feature="billing"><BillingPage /></PlanGate>)} />
                    <Route path="platform/faturalar" element={guarded('platform:manage', <PlanGate feature="billing"><PlatformInvoicesPage /></PlanGate>)} />

                    <Route path="404" element={<NotFoundPage />} />
                    <Route path="*" element={<Navigate to="/panel/404" replace />} />
                  </Route>
                </Route>

                {/* Panel dışındaki bilinmeyen adresler girişe döner */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
// CI/CD web deploy dogrulama
