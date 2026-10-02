import { apiFetch, qs } from './client'
import { tx } from '@/lib/i18n'

/**
 * Gateway öneki ile controller yolu üst üste bindiği için "compensation"
 * adresin içinde iki kez geçer. Yazım hatası değil.
 */
const BASE = '/api/compensation/compensation'

/* ------------------------------------------------------------------ tipler */

export type CompensationChangeReason =
  | 'Hire'
  | 'AnnualIncrease'
  | 'Promotion'
  | 'MarketAdjustment'
  | 'Demotion'
  | 'Other'

export const compensationReasonLabels: Record<CompensationChangeReason, string> = {
  Hire: tx('İşe alım'),
  AnnualIncrease: tx('Yıllık zam'),
  Promotion: tx('Terfi'),
  MarketAdjustment: tx('Piyasa düzeltmesi'),
  Demotion: tx('Görev değişikliği'),
  Other: tx('Diğer'),
}

export interface CompensationBand {
  id: string
  grade: string
  title: string | null
  minAmount: number
  midAmount: number
  maxAmount: number
  currency: string
  year: number
}

export interface CompensationRecord {
  id: string
  employeeId: string
  baseSalary: number
  currency: string
  grade: string | null
  reason: CompensationChangeReason
  effectiveFrom: string
  effectiveTo: string | null
  note: string | null
}

export interface SimulationLine {
  employeeId: string
  currentSalary: number
  proposedSalary: number
  increaseAmount: number
  increasePercent: number
  grade: string | null
  withinBand: boolean
  bandMax: number | null
}

export interface SimulationResult {
  employeeCount: number
  currentTotal: number
  proposedTotal: number
  budgetImpact: number
  outOfBandCount: number
  lines: SimulationLine[]
}

export interface CreateBandInput {
  grade: string
  title?: string
  minAmount: number
  midAmount: number
  maxAmount: number
  currency: string
  year: number
}

export interface CreateRecordInput {
  employeeId: string
  baseSalary: number
  currency: string
  grade?: string
  reason: CompensationChangeReason
  effectiveFrom: string
  note?: string
}

export interface SimulateInput {
  employeeIds: string[]
  increasePercent?: number
  flatIncrease?: number
  year: number
}

/* ------------------------------------------------------------------ servis */

export const compensationApi = {
  listBands: (year?: number, signal?: AbortSignal) =>
    apiFetch<CompensationBand[]>(`${BASE}/bands${qs({ year })}`, { signal }),

  createBand: (input: CreateBandInput) =>
    apiFetch<CompensationBand>(`${BASE}/bands`, { method: 'POST', body: input }),

  listRecords: (employeeId?: string, signal?: AbortSignal) =>
    apiFetch<CompensationRecord[]>(`${BASE}/records${qs({ employeeId })}`, { signal }),

  createRecord: (input: CreateRecordInput) =>
    apiFetch<CompensationRecord>(`${BASE}/records`, { method: 'POST', body: input }),

  simulate: (input: SimulateInput) =>
    apiFetch<SimulationResult>(`${BASE}/simulate`, { method: 'POST', body: input }),
}
