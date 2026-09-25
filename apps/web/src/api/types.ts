/* ============================ Organization Service ============================ */

export interface Department {
  id: string
  name: string
  companyId: string
  parentDepartmentId: string | null
  /** Departman başı (opsiyonel). Yalnızca `/departments` ucu döndürür; şirket yanıtında olmayabilir. */
  headEmployeeId?: string | null
}

export interface Company {
  id: string
  name: string
  taxNumber: string | null
  createdAt: string
  departments: Department[]
}

export interface CreateCompanyInput {
  name: string
  taxNumber?: string
}

export interface CreateDepartmentInput {
  name: string
  companyId: string
  parentDepartmentId?: string | null
}

/* ============================== Employee Service ============================== */

/** Backend enum'u JSON'da sayı olarak döner. */
export const EmployeeStatus = {
  Active: 0,
  OnLeave: 1,
  Terminated: 2,
} as const

export type EmployeeStatusValue = (typeof EmployeeStatus)[keyof typeof EmployeeStatus]

export const employeeStatusLabels: Record<EmployeeStatusValue, string> = {
  0: 'Aktif',
  1: 'İzinde',
  2: 'Ayrıldı',
}

export interface Assignment {
  id: string
  departmentId: string
  positionTitle: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

export interface Employee {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  hireDate: string
  status: EmployeeStatusValue
  assignments: Assignment[]
}

export interface CreateEmployeeInput {
  firstName: string
  lastName: string
  email: string
  phone?: string
  hireDate: string
}

export interface CreateAssignmentInput {
  departmentId: string
  positionTitle?: string
  effectiveFrom: string
}

/* ============================== Workflow Service ============================== */

export type WorkflowType =
  | 'LeaveRequest'
  | 'ExpenseClaim'
  | 'PositionChange'
  | 'AssetRequest'
  | 'Other'

export type WorkflowStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled'

export type StepDecision = 'Pending' | 'Approved' | 'Rejected' | 'Delegated'

export const workflowTypeLabels: Record<WorkflowType, string> = {
  LeaveRequest: 'İzin Talebi',
  ExpenseClaim: 'Masraf Talebi',
  PositionChange: 'Pozisyon Değişikliği',
  AssetRequest: 'Zimmet Talebi',
  Other: 'Diğer',
}

export const workflowStatusLabels: Record<WorkflowStatus, string> = {
  Pending: 'Beklemede',
  Approved: 'Onaylandı',
  Rejected: 'Reddedildi',
  Cancelled: 'İptal Edildi',
}

export const stepDecisionLabels: Record<StepDecision, string> = {
  Pending: 'Bekliyor',
  Approved: 'Onaylandı',
  Rejected: 'Reddedildi',
  Delegated: 'Devredildi',
}

export interface ApprovalStep {
  id: string
  order: number
  approverEmployeeId: string
  decision: StepDecision
  comment: string | null
  decidedAt: string | null
  delegatedToEmployeeId?: string | null
}

export interface Workflow {
  id: string
  type: WorkflowType
  status: WorkflowStatus
  requesterEmployeeId: string
  subject: string | null
  payload?: string | null
  createdAt: string
  slaDueAt: string | null
  steps?: ApprovalStep[]
}

export interface CreateWorkflowInput {
  type: WorkflowType
  requesterEmployeeId: string
  subject?: string
  payload?: string
  approverEmployeeIds: string[]
  slaHours?: number
}

export interface DecideStepInput {
  decision: 'Approved' | 'Rejected'
  comment?: string
}

export interface DelegateStepInput {
  delegateToEmployeeId: string
  comment?: string
}

/* ================================ ML Inference ================================ */

export interface MlHealth {
  status: string
  service: string
  model_loaded: boolean
}

export interface PredictResponse {
  prediction: number
  probability: number[]
  model: string
}

export interface FeatureContribution {
  feature: string
  contribution: number
}

export interface ExplainResponse {
  feature_contributions: FeatureContribution[] | Record<string, number>
  base_value: number
}

/* ==========================================================================
   Yeni modüller

   Her modül kendi tiplerini ve etiket sözlüklerini kendi servis dosyasında
   taşır; burada yeniden dışa aktarılır ki `@/api/types` tek giriş noktası
   olarak kalsın.
   ========================================================================== */

export * from './leave'
export * from './recruitment'
export * from './onboarding'
export * from './timeshift'
export * from './learning'
export * from './compensation'
export * from './expense'
export * from './notification'
