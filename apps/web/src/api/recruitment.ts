import { apiFetch, qs } from './client'

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
  Draft: 'Taslak',
  Published: 'Yayında',
  OnHold: 'Beklemede',
  Closed: 'Kapandı',
}

export const employmentTypeLabels: Record<EmploymentType, string> = {
  FullTime: 'Tam zamanlı',
  PartTime: 'Yarı zamanlı',
  Contract: 'Sözleşmeli',
  Intern: 'Stajyer',
}

export const applicationStatusLabels: Record<ApplicationStatus, string> = {
  Applied: 'Başvurdu',
  Screening: 'Ön eleme',
  Interview: 'Mülakat',
  Offer: 'Teklif',
  Hired: 'İşe alındı',
  Rejected: 'Reddedildi',
  Withdrawn: 'Geri çekildi',
}

export const interviewTypeLabels: Record<InterviewType, string> = {
  Phone: 'Telefon',
  Technical: 'Teknik',
  HR: 'İK',
  Final: 'Final',
}

export const interviewResultLabels: Record<InterviewResult, string> = {
  Pending: 'Bekliyor',
  Pass: 'Geçti',
  Fail: 'Kaldı',
  NoShow: 'Katılmadı',
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
}

export interface Interview {
  id: string
  type: InterviewType
  scheduledAt: string
  interviewerEmployeeId: string
  result: InterviewResult
  score: number | null
  notes: string | null
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
}

export interface CreateApplicationInput {
  jobPostingId: string
  candidateId: string
  notes?: string
}

export interface ScheduleInterviewInput {
  type: InterviewType
  scheduledAt: string
  interviewerEmployeeId: string
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
    apiFetch<Interview>(
      `${BASE}/applications/${applicationId}/interviews/${interviewId}/result`,
      { method: 'POST', body: input },
    ),
}
