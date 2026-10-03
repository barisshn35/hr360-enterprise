import { apiFetch, qs, type Paged } from './client'
import { tx } from '@/lib/i18n'

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
  Annual: tx('Yıllık izin'),
  Sick: tx('Hastalık izni'),
  Unpaid: tx('Ücretsiz izin'),
  Maternity: tx('Doğum izni'),
  Paternity: tx('Babalık izni'),
  Marriage: tx('Evlilik izni'),
  Bereavement: tx('Vefat izni'),
}

export const leaveStatusLabels: Record<LeaveStatus, string> = {
  Draft: tx('Taslak'),
  Submitted: tx('Onayda'),
  Approved: tx('Onaylandı'),
  Rejected: tx('Reddedildi'),
  Cancelled: tx('İptal edildi'),
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
  /** Saatlik izin (tek gün) */
  hours?: number | null
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
  /** Saatlik izin: yalnızca tek gün; gün = saat / 7,5 */
  hours?: number
}

export interface CreateLeaveBalanceInput {
  employeeId: string
  year: number
  type: LeaveType
  entitledDays: number
}

/** Şirketin resmi tatil takvimindeki bir gün (izin günü hesabında düşülür). */
export interface PublicHoliday {
  id: string
  date: string
  name: string
}

export interface LeaveRequestFilters {
  employeeId?: string
  status?: LeaveStatus
}

/** Sunucu tarafı sayfalama parametreleri (G24). `qTypes`: aramayla adı eşleşen izin türleri. */
export interface LeaveRequestPageParams extends LeaveRequestFilters {
  page: number
  pageSize: number
  q?: string
  qTypes?: string
  sort?: 'createdAt' | 'startDate' | 'days' | 'status' | 'type'
  dir?: 'asc' | 'desc'
}

/* ------------------------------------------------------------------ servis */

export const leaveApi = {
  listHolidays: (year?: number, signal?: AbortSignal) =>
    apiFetch<PublicHoliday[]>(`${BASE}/public-holidays${qs({ year })}`, { signal }),

  createHoliday: (input: { date: string; name: string }) =>
    apiFetch<PublicHoliday>(`${BASE}/public-holidays`, { method: 'POST', body: input }),

  /** Türkiye resmi tatillerini ekler (2026-2027 için dini bayramlar dahil). */
  seedTurkishHolidays: (year: number) =>
    apiFetch<{ added: number; skipped: number; religiousIncluded: boolean; message: string }>(
      `${BASE}/public-holidays/seed-tr${qs({ year })}`,
      { method: 'POST' },
    ),

  deleteHoliday: (id: string) =>
    apiFetch<void>(`${BASE}/public-holidays/${id}`, { method: 'DELETE' }),

  listBalances: (employeeId?: string, year?: number, signal?: AbortSignal) =>
    apiFetch<LeaveBalance[]>(`${BASE}/leave-balances${qs({ employeeId, year })}`, { signal }),

  createBalance: (input: CreateLeaveBalanceInput) =>
    apiFetch<LeaveBalance>(`${BASE}/leave-balances`, { method: 'POST', body: input }),

  listRequests: (filters: LeaveRequestFilters = {}, signal?: AbortSignal) =>
    apiFetch<LeaveRequest[]>(`${BASE}/leave-requests${qs(filters)}`, { signal }),

  pageRequests: (params: LeaveRequestPageParams, signal?: AbortSignal) =>
    apiFetch<Paged<LeaveRequest>>(`${BASE}/leave-requests${qs(params)}`, { signal }),

  getRequest: (id: string, signal?: AbortSignal) =>
    apiFetch<LeaveRequest>(`${BASE}/leave-requests/${id}`, { signal }),

  /** İK: kıdeme ve yaşa göre yasal yıllık izin (İş Kanunu m.53) ön izlemesi. */
  statutory: (year: number, signal?: AbortSignal) =>
    apiFetch<Array<{ employeeId: string; serviceYears: number; anniversary: string; statutoryDays: number; ageRule: boolean; currentEntitled: number | null; carriedOver: number }>>(
      `${BASE}/leave-balances/statutory?year=${year}`, { signal }),
  applyStatutory: (year: number) => apiFetch<{ changed: number }>(`${BASE}/leave-balances/statutory/apply`, { method: 'POST', body: { year } }),
  carryOver: (fromYear: number, maxDays?: number) =>
    apiFetch<{ employees: number; days: number }>(`${BASE}/leave-balances/carry-over`, { method: 'POST', body: { fromYear, maxDays } }),

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
