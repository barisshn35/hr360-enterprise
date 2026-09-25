import { apiFetch, qs } from './client'

const BASE = '/api/onboarding'

/* ------------------------------------------------------------------ tipler */

export type PlanStatus = 'NotStarted' | 'InProgress' | 'Completed' | 'Cancelled'
export type TaskCategory = 'IT' | 'HR' | 'Facility' | 'Training' | 'Legal' | 'Other'
export type OnboardingTaskStatus = 'Pending' | 'InProgress' | 'Done' | 'Blocked'
export type AssetType = 'Laptop' | 'Phone' | 'Monitor' | 'AccessCard' | 'Vehicle' | 'Other'
export type AssetStatus = 'Available' | 'Assigned' | 'Maintenance' | 'Retired' | 'Lost'

export const planStatusLabels: Record<PlanStatus, string> = {
  NotStarted: 'Başlamadı',
  InProgress: 'Sürüyor',
  Completed: 'Tamamlandı',
  Cancelled: 'İptal edildi',
}

export const taskCategoryLabels: Record<TaskCategory, string> = {
  IT: 'Bilgi teknolojileri',
  HR: 'İnsan kaynakları',
  Facility: 'İdari işler',
  Training: 'Eğitim',
  Legal: 'Hukuk',
  Other: 'Diğer',
}

export const onboardingTaskStatusLabels: Record<OnboardingTaskStatus, string> = {
  Pending: 'Bekliyor',
  InProgress: 'Sürüyor',
  Done: 'Tamamlandı',
  Blocked: 'Engellendi',
}

export const assetTypeLabels: Record<AssetType, string> = {
  Laptop: 'Dizüstü bilgisayar',
  Phone: 'Telefon',
  Monitor: 'Monitör',
  AccessCard: 'Giriş kartı',
  Vehicle: 'Araç',
  Other: 'Diğer',
}

export const assetStatusLabels: Record<AssetStatus, string> = {
  Available: 'Boşta',
  Assigned: 'Zimmetli',
  Maintenance: 'Bakımda',
  Retired: 'Hurdaya ayrıldı',
  Lost: 'Kayıp',
}

export interface OnboardingTask {
  id: string
  title: string
  category: TaskCategory
  status: OnboardingTaskStatus
  dueDate: string | null
  assigneeEmployeeId: string | null
  completedAt: string | null
}

export interface OnboardingPlan {
  id: string
  employeeId: string
  startDate: string
  templateName: string | null
  status: PlanStatus
  createdAt: string
  tasks?: OnboardingTask[]
}

export interface Asset {
  id: string
  assetTag: string
  type: AssetType
  model: string | null
  serialNumber: string | null
  status: AssetStatus
  assignedEmployeeId: string | null
  assignedOn: string | null
}

export interface CreatePlanInput {
  employeeId: string
  startDate: string
  templateName?: string
  useDefaultTasks: boolean
}

export interface CreateTaskInput {
  title: string
  category: TaskCategory
  dueDate?: string
  assigneeEmployeeId?: string
}

export interface CreateAssetInput {
  assetTag: string
  type: AssetType
  model?: string
  serialNumber?: string
}

export interface AssignAssetInput {
  employeeId: string
  assignedOn: string
  notes?: string
}

export interface ReturnAssetInput {
  returnedOn: string
  condition?: string
  markAsRetired: boolean
}

/* ------------------------------------------------------------------ servis */

export const onboardingApi = {
  listPlans: (
    filters: { employeeId?: string; status?: PlanStatus } = {},
    signal?: AbortSignal,
  ) => apiFetch<OnboardingPlan[]>(`${BASE}/onboarding-plans${qs(filters)}`, { signal }),

  getPlan: (id: string, signal?: AbortSignal) =>
    apiFetch<OnboardingPlan>(`${BASE}/onboarding-plans/${id}`, { signal }),

  createPlan: (input: CreatePlanInput) =>
    apiFetch<OnboardingPlan>(`${BASE}/onboarding-plans`, { method: 'POST', body: input }),

  addTask: (planId: string, input: CreateTaskInput) =>
    apiFetch<OnboardingTask>(`${BASE}/onboarding-plans/${planId}/tasks`, {
      method: 'POST',
      body: input,
    }),

  setTaskStatus: (planId: string, taskId: string, status: OnboardingTaskStatus) =>
    apiFetch<OnboardingTask>(`${BASE}/onboarding-plans/${planId}/tasks/${taskId}/status`, {
      method: 'POST',
      body: { status },
    }),

  listAssets: (filters: { status?: AssetStatus; type?: AssetType } = {}, signal?: AbortSignal) =>
    apiFetch<Asset[]>(`${BASE}/assets${qs(filters)}`, { signal }),

  getAsset: (id: string, signal?: AbortSignal) =>
    apiFetch<Asset>(`${BASE}/assets/${id}`, { signal }),

  createAsset: (input: CreateAssetInput) =>
    apiFetch<Asset>(`${BASE}/assets`, { method: 'POST', body: input }),

  assignAsset: (id: string, input: AssignAssetInput) =>
    apiFetch<Asset>(`${BASE}/assets/${id}/assign`, { method: 'POST', body: input }),

  returnAsset: (id: string, input: ReturnAssetInput) =>
    apiFetch<Asset>(`${BASE}/assets/${id}/return`, { method: 'POST', body: input }),

  assetsByEmployee: (employeeId: string, signal?: AbortSignal) =>
    apiFetch<Asset[]>(`${BASE}/assets/by-employee/${employeeId}`, { signal }),
}
