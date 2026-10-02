import { apiFetch, qs } from './client'
import { tx } from '@/lib/i18n'

const BASE = '/api/expense'

/* ------------------------------------------------------------------ tipler */

export type ClaimStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Paid'
export type ExpenseCategory =
  | 'Travel'
  | 'Meal'
  | 'Accommodation'
  | 'Transport'
  | 'Supplies'
  | 'Training'
  | 'Other'
export type CaseCategory = 'Payroll' | 'Benefits' | 'Policy' | 'Complaint' | 'ITSupport' | 'Other'
export type CasePriority = 'Low' | 'Normal' | 'High' | 'Urgent'
export type CaseStatus = 'Open' | 'InProgress' | 'WaitingOnEmployee' | 'Resolved' | 'Closed'

export const claimStatusLabels: Record<ClaimStatus, string> = {
  Draft: tx('Taslak'),
  Submitted: tx('Onayda'),
  Approved: tx('Onaylandı'),
  Rejected: tx('Reddedildi'),
  Paid: tx('Ödendi'),
}

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  Travel: tx('Seyahat'),
  Meal: tx('Yemek'),
  Accommodation: tx('Konaklama'),
  Transport: tx('Ulaşım'),
  Supplies: tx('Sarf malzeme'),
  Training: tx('Eğitim'),
  Other: tx('Diğer'),
}

export const caseCategoryLabels: Record<CaseCategory, string> = {
  Payroll: tx('Bordro'),
  Benefits: tx('Yan haklar'),
  Policy: tx('Politika'),
  Complaint: tx('Şikâyet'),
  ITSupport: tx('BT desteği'),
  Other: tx('Diğer'),
}

export const casePriorityLabels: Record<CasePriority, string> = {
  Low: tx('Düşük'),
  Normal: tx('Normal'),
  High: tx('Yüksek'),
  Urgent: tx('Acil'),
}

export const caseStatusLabels: Record<CaseStatus, string> = {
  Open: tx('Açık'),
  InProgress: tx('Sürüyor'),
  WaitingOnEmployee: tx('Çalışan bekleniyor'),
  Resolved: tx('Çözüldü'),
  Closed: tx('Kapandı'),
}

export interface ExpenseItem {
  id?: string
  category: ExpenseCategory
  amount: number
  expenseDate: string
  description?: string | null
  receiptStorageKey?: string | null
}

export interface ExpenseClaim {
  id: string
  employeeId: string
  title: string
  currency: string
  status: ClaimStatus
  /** Kalemlerden hesaplanır; gönderilmez. */
  totalAmount: number
  createdAt: string
  workflowRequestId: string | null
  items?: ExpenseItem[]
}

export interface HrCase {
  id: string
  employeeId: string
  subject: string
  description: string | null
  category: CaseCategory
  priority: CasePriority
  status: CaseStatus
  assignedToEmployeeId: string | null
  resolution: string | null
  createdAt: string
  resolvedAt: string | null
}

/** Backend `DocumentType` (expense-service, string enum). */
export type DocumentType = 'Contract' | 'Payslip' | 'IdCard' | 'Diploma' | 'Certificate' | 'Health' | 'Other'

export const documentTypeLabels: Record<DocumentType, string> = {
  Contract: tx('Sözleşme'),
  Payslip: tx('Bordro'),
  IdCard: tx('Kimlik'),
  Diploma: tx('Diploma'),
  Certificate: tx('Sertifika'),
  Health: tx('Sağlık raporu'),
  Other: tx('Diğer'),
}

/** NOT: Önceden `name`/`createdAt` bekleniyordu; backend `fileName`/`uploadedAt`
 * döner - listede ad sütunu boş, tarih "—" görünüyordu. */
export interface HrDocument {
  id: string
  employeeId: string
  type: DocumentType
  fileName: string
  /** Dosya bağlı değilse boş string. */
  storageKey: string
  sizeBytes: number
  contentType: string | null
  uploadedAt: string
  uploadedByEmployeeId: string | null
}

export interface CreateClaimInput {
  employeeId: string
  title: string
  currency: string
  items: ExpenseItem[]
}

export interface CreateCaseInput {
  employeeId: string
  subject: string
  description?: string
  category: CaseCategory
  priority: CasePriority
}

export interface CreateDocumentInput {
  employeeId: string
  type: DocumentType
  fileName: string
  storageKey?: string
}

/* ------------------------------------------------------------------ servis */

export const expenseApi = {
  listClaims: (
    filters: { employeeId?: string; status?: ClaimStatus } = {},
    signal?: AbortSignal,
  ) => apiFetch<ExpenseClaim[]>(`${BASE}/expense-claims${qs(filters)}`, { signal }),

  getClaim: (id: string, signal?: AbortSignal) =>
    apiFetch<ExpenseClaim>(`${BASE}/expense-claims/${id}`, { signal }),

  createClaim: (input: CreateClaimInput) =>
    apiFetch<ExpenseClaim>(`${BASE}/expense-claims`, { method: 'POST', body: input }),

  submitClaim: (id: string, workflowRequestId?: string) =>
    apiFetch<ExpenseClaim>(`${BASE}/expense-claims/${id}/submit`, {
      method: 'POST',
      body: { workflowRequestId },
    }),

  resolveClaim: (id: string, approved: boolean) =>
    apiFetch<ExpenseClaim>(`${BASE}/expense-claims/${id}/resolve`, {
      method: 'POST',
      body: { approved },
    }),

  markPaid: (id: string) =>
    apiFetch<ExpenseClaim>(`${BASE}/expense-claims/${id}/mark-paid`, { method: 'POST' }),

  listDocuments: (
    filters: { employeeId?: string; type?: string } = {},
    signal?: AbortSignal,
  ) => apiFetch<HrDocument[]>(`${BASE}/documents${qs(filters)}`, { signal }),

  createDocument: (input: CreateDocumentInput) =>
    apiFetch<HrDocument>(`${BASE}/documents`, { method: 'POST', body: input }),

  deleteDocument: (id: string) =>
    apiFetch<void>(`${BASE}/documents/${id}`, { method: 'DELETE' }),

  listCases: (
    filters: { employeeId?: string; status?: CaseStatus; priority?: CasePriority } = {},
    signal?: AbortSignal,
  ) => apiFetch<HrCase[]>(`${BASE}/hr-cases${qs(filters)}`, { signal }),

  getCase: (id: string, signal?: AbortSignal) =>
    apiFetch<HrCase>(`${BASE}/hr-cases/${id}`, { signal }),

  createCase: (input: CreateCaseInput) =>
    apiFetch<HrCase>(`${BASE}/hr-cases`, { method: 'POST', body: input }),

  assignCase: (id: string, assignedToEmployeeId: string) =>
    apiFetch<HrCase>(`${BASE}/hr-cases/${id}/assign`, {
      method: 'POST',
      body: { assignedToEmployeeId },
    }),

  resolveCase: (id: string, resolution: string) =>
    apiFetch<HrCase>(`${BASE}/hr-cases/${id}/resolve`, { method: 'POST', body: { resolution } }),
}
