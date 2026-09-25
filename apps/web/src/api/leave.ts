import { apiFetch, qs } from './client'

const BASE = '/api/leave'

/* ------------------------------------------------------------------ tipler */

export type LeaveType =
  | 'Annual'
  | 'Sick'
  | 'Unpaid'
  | 'Maternity'
  | 'Paternity'
  | 'Marriage'
  | 'Bereavement'

export type LeaveStatus = 'Draft' | 'Submitted' | 'Approved' | 'Rejected' | 'Cancelled'

export const leaveTypeLabels: Record<LeaveType, string> = {
  Annual: 'Yıllık izin',
  Sick: 'Hastalık izni',
  Unpaid: 'Ücretsiz izin',
  Maternity: 'Doğum izni',
  Paternity: 'Babalık izni',
  Marriage: 'Evlilik izni',
  Bereavement: 'Vefat izni',
}

export const leaveStatusLabels: Record<LeaveStatus, string> = {
  Draft: 'Taslak',
  Submitted: 'Onayda',
  Approved: 'Onaylandı',
  Rejected: 'Reddedildi',
  Cancelled: 'İptal edildi',
}

export interface LeaveBalance {
  id: string
  employeeId: string
  year: number
  type: LeaveType
  entitledDays: number
  usedDays: number
  pendingDays: number
  /** Backend'de hesaplanır, salt okunur. */
  remainingDays: number
}

export interface LeaveRequest {
  id: string
  employeeId: string
  type: LeaveType
  status: LeaveStatus
  startDate: string
  endDate: string
  days: number
  reason: string | null
  workflowRequestId: string | null
  createdAt: string
}

export interface CreateLeaveRequestInput {
  employeeId: string
  type: LeaveType
  startDate: string
  endDate: string
  days: number
  reason?: string
  workflowRequestId?: string
}

export interface CreateLeaveBalanceInput {
  employeeId: string
  year: number
  type: LeaveType
  entitledDays: number
}

export interface LeaveRequestFilters {
  employeeId?: string
  status?: LeaveStatus
}

/* ------------------------------------------------------------------ servis */

export const leaveApi = {
  listBalances: (employeeId?: string, year?: number, signal?: AbortSignal) =>
    apiFetch<LeaveBalance[]>(`${BASE}/leave-balances${qs({ employeeId, year })}`, { signal }),

  createBalance: (input: CreateLeaveBalanceInput) =>
    apiFetch<LeaveBalance>(`${BASE}/leave-balances`, { method: 'POST', body: input }),

  listRequests: (filters: LeaveRequestFilters = {}, signal?: AbortSignal) =>
    apiFetch<LeaveRequest[]>(`${BASE}/leave-requests${qs(filters)}`, { signal }),

  getRequest: (id: string, signal?: AbortSignal) =>
    apiFetch<LeaveRequest>(`${BASE}/leave-requests/${id}`, { signal }),

  createRequest: (input: CreateLeaveRequestInput) =>
    apiFetch<LeaveRequest>(`${BASE}/leave-requests`, { method: 'POST', body: input }),

  cancelRequest: (id: string) =>
    apiFetch<LeaveRequest>(`${BASE}/leave-requests/${id}/cancel`, { method: 'POST' }),

  /**
   * NOT: Normal akışta çağrılmaz. Workflow onaylanınca Kafka olayı bu işi
   * kendiliğinden yapar; arayüzde "onayla" düğmesi yoktur.
   */
  resolveRequest: (id: string, approved: boolean) =>
    apiFetch<LeaveRequest>(`${BASE}/leave-requests/${id}/resolve`, {
      method: 'POST',
      body: { approved },
    }),
}
