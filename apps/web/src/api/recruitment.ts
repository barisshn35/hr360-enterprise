import { apiFetch, qs } from './client'
import { tx } from '@/lib/i18n'

const BASE = '/api/recruitment'

/* ------------------------------------------------------------------ tipler */

export type JobPostingStatus = 'Draft' | 'Published' | 'OnHold' | 'Closed'
export type EmploymentType = 'FullTime' | 'PartTime' | 'Contract' | 'Intern'
export type ApplicationStatus =
  | 'Applied'
  | 'Screening'
  | 'Interview'
  | 'Offer'
  | 'Hired'
  | 'Rejected'
  | 'Withdrawn'
export type InterviewType = 'Phone' | 'Technical' | 'HR' | 'Final'
export type InterviewResult = 'Pending' | 'Pass' | 'Fail' | 'NoShow'

export const jobPostingStatusLabels: Record<JobPostingStatus, string> = {
  Draft: tx('Taslak'),
  Published: tx('Yayında'),
  OnHold: tx('Beklemede'),
  Closed: tx('Kapandı'),
}

export const employmentTypeLabels: Record<EmploymentType, string> = {
  FullTime: tx('Tam zamanlı'),
  PartTime: tx('Yarı zamanlı'),
  Contract: tx('Sözleşmeli'),
  Intern: tx('Stajyer'),
}

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  Applied: tx('Başvurdu'),
  Screening: tx('Ön eleme'),
  Interview: tx('Mülakat'),
  Offer: tx('Teklif'),
  Hired: tx('İşe alındı'),
  Rejected: tx('Reddedildi'),
  Withdrawn: tx('Geri çekildi'),
}

export const interviewTypeLabels: Record<InterviewType, string> = {
  Phone: tx('Telefon'),
  Technical: tx('Teknik'),
  HR: tx('İK'),
  Final: tx('Final'),
}

export const interviewResultLabels: Record<InterviewResult, string> = {
  Pending: tx('Bekliyor'),
  Pass: tx('Geçti'),
  Fail: tx('Kaldı'),
  NoShow: tx('Katılmadı'),
}

/** Huni sırası — aday bu aşamalardan geçer, sıralama anlamlıdır. */
export const APPLICATION_FUNNEL: ApplicationStatus[] = [
  'Applied',
  'Screening',
  'Interview',
  'Offer',
  'Hired',
]

export interface JobPosting {
  id: string
  title: string
  departmentId: string
  description: string | null
  employmentType: EmploymentType
  headcount: number
  status: JobPostingStatus
  createdAt: string
  publishedAt?: string | null
  applications?: Application[]
  /** Liste ucunda başvuru sayısı (yalnızca aday görme yetkisi olana). */
  applicationCount?: number | null
}

export interface Candidate {
  id: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
  resumeStorageKey: string | null
  source: string | null
  createdAt: string
  applications?: Application[]
  skills?: string[]
  resumeText?: string | null
  talentPoolConsent?: boolean
  anonymizedAt?: string | null
}

export interface Interview {
  id: string
  type: InterviewType
  scheduledAt: string
  interviewerEmployeeId: string
  result: InterviewResult
  score: number | null
  notes: string | null
  durationMinutes?: number
  location?: string | null
  meetingUrl?: string | null
  interviewerIds?: string[]
}

export interface Application {
  id: string
  jobPostingId: string
  candidateId: string
  status: ApplicationStatus
  notes: string | null
  /** Backend `Application.AppliedAt` (önceden `createdAt` okunuyordu → "— tarihinde başvurdu"). */
  appliedAt: string
  interviews?: Interview[]
  /** Manual | Career (kariyer sayfası) */
  channel?: string
  coverNote?: string | null
  ownsCandidate?: boolean
  duplicateReason?: string | null
}

export interface CreateJobPostingInput {
  title: string
  departmentId: string
  description?: string
  employmentType: EmploymentType
  headcount: number
}

export interface CreateCandidateInput {
  firstName: string
  lastName: string
  email: string
  phone?: string
  resumeStorageKey?: string
  source?: string
  skills?: string[]
  resumeText?: string
  /** Telefon eşleşmesi uyarısına rağmen kaydet (aynı e-posta zorlanamaz). */
  force?: boolean
}

export interface CreateApplicationInput {
  jobPostingId: string
  candidateId: string
  notes?: string
}

export interface ScheduleInterviewInput {
  type: InterviewType
  scheduledAt: string
  interviewerEmployeeId?: string
  interviewerEmployeeIds?: string[]
  durationMinutes?: number
  location?: string
  meetingUrl?: string
  notifyCandidate?: boolean
}

export interface ScheduledInterview extends Interview {
  candidateNotified: boolean
  invitationText: string
}

/* ----------------------------------------------- Dalga 5c: kanban, puan kartı, teklif */

export interface DuplicateCheck {
  duplicate: boolean
  strength?: 'Strong' | 'Possible'
  reason?: 'email' | 'phone+name' | 'phone'
  message?: string
  canForce?: boolean
  candidate?: { id: string; firstName: string; lastName: string; createdAt: string }
}

export interface PipelineCard {
  id: string
  candidateId: string
  candidateName: string | null
  status: ApplicationStatus
  appliedAt: string
  statusChangedAt: string | null
  channel: string
  duplicateReason: string | null
  interviewCount: number
  nextInterviewAt: string | null
  averageScore: number | null
  offerStatus: OfferStatus | null
}

export interface Pipeline {
  stages: Array<{ key: ApplicationStatus; terminal: boolean }>
  cards: PipelineCard[]
}

export interface ScorecardCriterion { key: string; label: string; weight: number }
export interface CriterionScore { key: string; score: number }
export interface NoteWarning { category: string; term: string; message: string }
export type Recommendation = 'StrongNo' | 'No' | 'Yes' | 'StrongYes'

export const recommendationLabels: Record<Recommendation, string> = {
  StrongNo: tx('Kesinlikle hayır'),
  No: tx('Hayır'),
  Yes: tx('Evet'),
  StrongYes: tx('Kesinlikle evet'),
}

export interface ScorecardForm {
  criteria: ScorecardCriterion[]
  canSubmit: boolean
  hint: string
  mine: { scores: CriterionScore[]; overallScore: number | null; recommendation: Recommendation | null; notes: string | null; submittedAt: string } | null
}

export interface ScorecardView {
  id: string
  interviewerEmployeeId: string
  interviewer: string | null
  scores: CriterionScore[]
  overallScore: number | null
  recommendation: Recommendation | null
  notes: string | null
  submittedAt: string
  warnings: NoteWarning[]
}

export interface MyInterview {
  id: string
  applicationId: string
  type: InterviewType
  scheduledAt: string
  durationMinutes: number
  location: string | null
  meetingUrl: string | null
  result: InterviewResult
  candidateName: string | null
  posting: string | null
  jobPostingId: string | null
  myScorecard: { submitted: boolean; overallScore: number | null } | null
}

export type OfferStatus = 'PendingApproval' | 'Approved' | 'Rejected' | 'Sent' | 'Accepted' | 'Declined' | 'Withdrawn' | 'Expired'

export const offerStatusLabels: Record<OfferStatus, string> = {
  PendingApproval: tx('Onay bekliyor'),
  Approved: tx('Onaylandı'),
  Rejected: tx('Reddedildi'),
  Sent: tx('Adaya gönderildi'),
  Accepted: tx('Kabul edildi'),
  Declined: tx('Aday reddetti'),
  Withdrawn: tx('Geri çekildi'),
  Expired: tx('Süresi doldu'),
}

export interface Offer {
  id: string
  applicationId: string
  positionTitle: string
  /** Yalnızca İK ve teklifin onaycısına dolu gelir. */
  grossSalary: number | null
  currency: string
  startDate: string
  benefits: string | null
  expiresAt: string
  letterText: string | null
  status: OfferStatus
  workflowRequestId: string | null
  approverEmployeeId: string | null
  decisionNote: string | null
  decidedAt: string | null
  sentAt: string | null
  respondedAt: string | null
  createdAt: string
  hrDecides: boolean
  salaryVisible: boolean
}

export interface OfferInput {
  applicationId: string
  positionTitle: string
  grossSalary: number
  currency: string
  startDate: string
  benefits?: string
  expiresAt: string
}

/* ----------------------------------------------- herkese açık kariyer sayfası (Y16) */

export interface PublicJob {
  id: string
  title: string
  description: string | null
  employmentType: EmploymentType
  department: string | null
  publishedAt: string | null
}

export interface PublicJobs {
  company: string
  privacyNotice: { version: string; text: string }
  retentionDays: number
  poolMonths: number
  jobs: PublicJob[]
}

export interface PublicApplyInput {
  firstName: string
  lastName: string
  email: string
  phone?: string
  coverNote?: string
  resumeText?: string
  talentPoolConsent: boolean
  privacyNoticeVersion: string
  website?: string
}

export interface PublicApplyResult {
  applicationId: string
  token: string
  selfServicePath: string
  linkedToExisting: boolean
  talentPoolConsent: boolean
  message: string
}

export interface SelfService {
  company: string
  posting: string | null
  status: 'Received' | 'InReview' | 'Offer' | 'Positive' | 'Negative' | 'Withdrawn' | 'Closed'
  statusLabel: string
  appliedAt: string
  ownsCandidate: boolean
  data: { firstName: string; lastName: string; email: string; phone: string | null; coverNote: string | null; resumeText: string | null }
  talentPoolConsent: boolean
  retention: string
  interviews: Array<{ scheduledAt: string; durationMinutes: number; location: string | null; meetingUrl: string | null; type: InterviewType }>
  offer: { id: string; status: OfferStatus; positionTitle: string; startDate: string; expiresAt: string; letterText: string } | null
  privacyNotice: { version: string; text: string }
}

export interface InterviewResultInput {
  result: InterviewResult
  score?: number
  notes?: string
}

/* ------------------------------------------------------------------ servis */

export const recruitmentApi = {
  listPostings: (status?: JobPostingStatus, signal?: AbortSignal) =>
    apiFetch<JobPosting[]>(`${BASE}/job-postings${qs({ status })}`, { signal }),

  getPosting: (id: string, signal?: AbortSignal) =>
    apiFetch<JobPosting>(`${BASE}/job-postings/${id}`, { signal }),

  createPosting: (input: CreateJobPostingInput) =>
    apiFetch<JobPosting>(`${BASE}/job-postings`, { method: 'POST', body: input }),

  publishPosting: (id: string) =>
    apiFetch<JobPosting>(`${BASE}/job-postings/${id}/publish`, { method: 'POST' }),

  closePosting: (id: string) =>
    apiFetch<JobPosting>(`${BASE}/job-postings/${id}/close`, { method: 'POST' }),

  listCandidates: (search?: string, signal?: AbortSignal) =>
    apiFetch<Candidate[]>(`${BASE}/candidates${qs({ search })}`, { signal }),

  getCandidate: (id: string, signal?: AbortSignal) =>
    apiFetch<Candidate>(`${BASE}/candidates/${id}`, { signal }),

  createCandidate: (input: CreateCandidateInput) =>
    apiFetch<Candidate>(`${BASE}/candidates`, { method: 'POST', body: input }),

  listApplications: (
    filters: { jobPostingId?: string; status?: ApplicationStatus } = {},
    signal?: AbortSignal,
  ) => apiFetch<Application[]>(`${BASE}/applications${qs(filters)}`, { signal }),

  getApplication: (id: string, signal?: AbortSignal) =>
    apiFetch<Application>(`${BASE}/applications/${id}`, { signal }),

  createApplication: (input: CreateApplicationInput) =>
    apiFetch<Application>(`${BASE}/applications`, { method: 'POST', body: input }),

  setApplicationStatus: (id: string, status: ApplicationStatus, notes?: string) =>
    apiFetch<Application>(`${BASE}/applications/${id}/status`, {
      method: 'POST',
      body: { status, notes },
    }),

  scheduleInterview: (applicationId: string, input: ScheduleInterviewInput) =>
    apiFetch<Interview>(`${BASE}/applications/${applicationId}/interviews`, {
      method: 'POST',
      body: input,
    }),

  setInterviewResult: (applicationId: string, interviewId: string, input: InterviewResultInput) =>
    apiFetch<Interview & { warnings: NoteWarning[] }>(
      `${BASE}/applications/${applicationId}/interviews/${interviewId}/result`,
      { method: 'POST', body: input },
    ),

  /* --------------------------------------------------- Dalga 5c */
  checkDuplicates: (q: { firstName?: string; lastName?: string; email?: string; phone?: string }, signal?: AbortSignal) =>
    apiFetch<DuplicateCheck>(`${BASE}/candidates/duplicates${qs(q)}`, { signal }),

  pipeline: (jobPostingId: string, signal?: AbortSignal) =>
    apiFetch<Pipeline>(`${BASE}/applications/pipeline${qs({ jobPostingId })}`, { signal }),
  moveApplication: (id: string, status: ApplicationStatus) =>
    apiFetch<{ id: string; status: ApplicationStatus }>(`${BASE}/applications/${id}/move`, { method: 'POST', body: { status } }),
  scheduleInterviewPlus: (applicationId: string, input: ScheduleInterviewInput) =>
    apiFetch<ScheduledInterview>(`${BASE}/applications/${applicationId}/interviews`, { method: 'POST', body: input }),

  scorecardTemplate: (postingId: string, signal?: AbortSignal) =>
    apiFetch<{ criteria: ScorecardCriterion[]; isDefault: boolean }>(`${BASE}/job-postings/${postingId}/scorecard-template`, { signal }),
  saveScorecardTemplate: (postingId: string, criteria: ScorecardCriterion[]) =>
    apiFetch<{ criteria: ScorecardCriterion[] }>(`${BASE}/job-postings/${postingId}/scorecard-template`, { method: 'PUT', body: { criteria } }),
  myInterviews: (signal?: AbortSignal) => apiFetch<MyInterview[]>(`${BASE}/interviews/mine`, { signal }),
  scorecardForm: (interviewId: string, signal?: AbortSignal) =>
    apiFetch<ScorecardForm>(`${BASE}/interviews/${interviewId}/scorecard-form`, { signal }),
  submitScorecard: (interviewId: string, body: { scores: CriterionScore[]; recommendation?: Recommendation; notes?: string }) =>
    apiFetch<{ overallScore: number; warnings: NoteWarning[] }>(`${BASE}/interviews/${interviewId}/scorecard`, { method: 'POST', body }),
  scorecards: (interviewId: string, signal?: AbortSignal) =>
    apiFetch<{ criteria: ScorecardCriterion[]; average: number | null; pending: string[]; scorecards: ScorecardView[] }>(
      `${BASE}/interviews/${interviewId}/scorecards`, { signal }),
  notesCheck: (text: string, signal?: AbortSignal) =>
    apiFetch<{ warnings: NoteWarning[] }>(`${BASE}/interviews/notes-check`, { method: 'POST', body: { text }, signal }),

  offerTemplate: (signal?: AbortSignal) =>
    apiFetch<{ body: string; isDefault: boolean; placeholders: string[] }>(`${BASE}/offers/template`, { signal }),
  saveOfferTemplate: (body: string) =>
    apiFetch<{ body: string }>(`${BASE}/offers/template`, { method: 'PUT', body: { body } }),
  previewOffer: (input: OfferInput) => apiFetch<{ letterText: string }>(`${BASE}/offers/preview`, { method: 'POST', body: input }),
  createOffer: (input: OfferInput) =>
    apiFetch<{ offer: Offer; approvalNote: string; hrDecides: boolean }>(`${BASE}/offers`, { method: 'POST', body: input }),
  offers: (filters: { applicationId?: string; jobPostingId?: string }, signal?: AbortSignal) =>
    apiFetch<Offer[]>(`${BASE}/offers${qs(filters)}`, { signal }),
  decideOffer: (id: string, approve: boolean, note?: string) =>
    apiFetch<Offer>(`${BASE}/offers/${id}/decide`, { method: 'POST', body: { approve, note } }),
  sendOffer: (id: string) => apiFetch<Offer>(`${BASE}/offers/${id}/send`, { method: 'POST' }),
  respondOffer: (id: string, accept: boolean) =>
    apiFetch<{ offer: Offer; applicationStatus: ApplicationStatus }>(`${BASE}/offers/${id}/respond`, { method: 'POST', body: { accept } }),
  withdrawOffer: (id: string) => apiFetch<Offer>(`${BASE}/offers/${id}/withdraw`, { method: 'POST' }),

  retentionSettings: (signal?: AbortSignal) =>
    apiFetch<{ retentionDays: number; poolMonths: number; noticeVersion: string }>(`${BASE}/retention/settings`, { signal }),
  runRetention: () => apiFetch<{ anonymized: number }>(`${BASE}/retention/run`, { method: 'POST' }),
}

/** Oturumsuz kariyer sayfası uçları (Y16). */
export const careerApi = {
  jobs: (tenant: string, signal?: AbortSignal) =>
    apiFetch<PublicJobs>(`${BASE}/public/${encodeURIComponent(tenant)}/jobs`, { signal, anonymous: true }),
  apply: (tenant: string, jobId: string, input: PublicApplyInput) =>
    apiFetch<PublicApplyResult>(`${BASE}/public/${encodeURIComponent(tenant)}/jobs/${jobId}/apply`, { method: 'POST', body: input, anonymous: true, noQueue: true }),
  selfService: (tenant: string, token: string, signal?: AbortSignal) =>
    apiFetch<SelfService>(`${BASE}/public/${encodeURIComponent(tenant)}/self-service/${encodeURIComponent(token)}`, { signal, anonymous: true }),
  consent: (tenant: string, token: string, talentPool: boolean) =>
    apiFetch<{ talentPoolConsent: boolean }>(`${BASE}/public/${encodeURIComponent(tenant)}/self-service/${encodeURIComponent(token)}/consent`,
      { method: 'POST', body: { talentPool }, anonymous: true, noQueue: true }),
  respondOffer: (tenant: string, token: string, accept: boolean) =>
    apiFetch<{ status: OfferStatus }>(`${BASE}/public/${encodeURIComponent(tenant)}/self-service/${encodeURIComponent(token)}/offer/respond`,
      { method: 'POST', body: { accept }, anonymous: true, noQueue: true }),
  remove: (tenant: string, token: string) =>
    apiFetch<{ deleted: boolean; scope: 'candidate' | 'application' }>(`${BASE}/public/${encodeURIComponent(tenant)}/self-service/${encodeURIComponent(token)}`,
      { method: 'DELETE', anonymous: true, noQueue: true }),
}
