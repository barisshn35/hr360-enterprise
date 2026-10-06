import { apiFetch, qs } from './client'

/** Gateway öneki ile controller yolu üst üste bindiği için "compensation" iki kez geçer. */
const BASE = '/api/compensation/compensation'

export type PayrollPeriodStatus = 'Open' | 'Calculated' | 'Closed'

export interface PayrollPeriod {
  id: string
  year: number
  month: number
  status: PayrollPeriodStatus
  calculatedAt: string | null
  /** Son hesaplayan (görevler ayrılığı: bu kişi dönemi kapatamaz). */
  calculatedBy?: string | null
  closedAt: string | null
  closedBy: string | null
  employeeCount: number
  totalGross: number
  totalNet: number
  totalEmployerCost: number
}

export interface TaxBracket { upTo: number | null; rate: number }

export interface PayrollParameters {
  year: number
  minimumWageGross: number
  sgkEmployeeRate: number
  unemploymentEmployeeRate: number
  sgkEmployerRate: number
  employerIncentivePoints: number
  effectiveEmployerSgkRate: number
  unemploymentEmployerRate: number
  stampTaxRate: number
  sgkCeilingMultiplier: number
  sgkCeiling: number
  overtimeMultiplier: number
  monthlyHours: number
  brackets: TaxBracket[]
  isCustom: boolean
}

export interface Payslip {
  id: string
  periodId: string
  employeeId: string
  year: number
  month: number
  currency: string
  monthlyBaseGross: number
  paidDays: number
  unpaidDays: number
  overtimeHours: number
  baseGross: number
  overtimePay: number
  additions: number
  gross: number
  sgkBase: number
  sgkEmployee: number
  unemploymentEmployee: number
  taxBase: number
  cumulativeTaxBase: number
  incomeTax: number
  incomeTaxExemption: number
  stampTax: number
  stampTaxExemption: number
  deductions: number
  net: number
  sgkEmployer: number
  unemploymentEmployer: number
  employerCost: number
}

export interface PayslipDetail {
  payslip: Payslip
  rates: { sgkEmployeeRate: number; unemploymentEmployeeRate: number; stampTaxRate: number; employerSgkRate: number; unemploymentEmployerRate: number }
}

export type AdjustmentKind = 'Addition' | 'Deduction'
export interface PayrollAdjustment { id: string; periodId: string; employeeId: string; kind: AdjustmentKind; amount: number; description: string; createdAt: string }

export const payrollApi = {
  periods: (year?: number, signal?: AbortSignal) => apiFetch<PayrollPeriod[]>(`${BASE}/payroll/periods${qs({ year })}`, { signal }),
  createPeriod: (year: number, month: number) => apiFetch<PayrollPeriod>(`${BASE}/payroll/periods`, { method: 'POST', body: { year, month } }),
  deletePeriod: (id: string) => apiFetch<void>(`${BASE}/payroll/periods/${id}`, { method: 'DELETE' }),
  calculate: (id: string) => apiFetch<{ employeeCount: number }>(`${BASE}/payroll/periods/${id}/calculate`, { method: 'POST' }),
  close: (id: string) => apiFetch<PayrollPeriod>(`${BASE}/payroll/periods/${id}/close`, { method: 'POST' }),
  reopen: (id: string, reason: string) => apiFetch<PayrollPeriod>(`${BASE}/payroll/periods/${id}/reopen`, { method: 'POST', body: { reason } }),
  payslips: (id: string, signal?: AbortSignal) => apiFetch<Payslip[]>(`${BASE}/payroll/periods/${id}/payslips`, { signal }),
  adjustments: (id: string, signal?: AbortSignal) => apiFetch<PayrollAdjustment[]>(`${BASE}/payroll/periods/${id}/adjustments`, { signal }),
  addAdjustment: (id: string, body: { employeeId: string; kind: AdjustmentKind; amount: number; description: string }) =>
    apiFetch<PayrollAdjustment>(`${BASE}/payroll/periods/${id}/adjustments`, { method: 'POST', body }),
  deleteAdjustment: (id: string, adjId: string) => apiFetch<void>(`${BASE}/payroll/periods/${id}/adjustments/${adjId}`, { method: 'DELETE' }),
  parameters: (year: number, signal?: AbortSignal) => apiFetch<PayrollParameters>(`${BASE}/payroll/parameters/${year}`, { signal }),
  saveParameters: (year: number, body: Pick<PayrollParameters, 'minimumWageGross' | 'sgkEmployerRate' | 'employerIncentivePoints' | 'stampTaxRate' | 'sgkCeilingMultiplier' | 'brackets'>) =>
    apiFetch<PayrollParameters>(`${BASE}/payroll/parameters/${year}`, { method: 'PUT', body }),
  resetParameters: (year: number) => apiFetch<void>(`${BASE}/payroll/parameters/${year}`, { method: 'DELETE' }),
  myPayslips: (signal?: AbortSignal) => apiFetch<Payslip[]>(`${BASE}/payslips/me`, { signal }),
  payslip: (id: string, signal?: AbortSignal) => apiFetch<PayslipDetail>(`${BASE}/payslips/${id}`, { signal }),
}
