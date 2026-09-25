import { apiFetch, qs } from './client'
import type { Assignment, CreateAssignmentInput, CreateEmployeeInput, Employee } from './types'

const BASE = '/api/employee'

export const employeeApi = {
  /** email verilirse tek kaydı döner - "employee" rolü SADECE bu şekilde
   * (kendi e-postasıyla) sorgulayabilir; manager+ email'siz tüm listeyi çeker. */
  list: (signal?: AbortSignal, email?: string) =>
    apiFetch<Employee[]>(`${BASE}/employees${qs({ email })}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    apiFetch<Employee>(`${BASE}/employees/${id}`, { signal }),

  create: (input: CreateEmployeeInput) =>
    apiFetch<Employee>(`${BASE}/employees`, { method: 'POST', body: input }),

  addAssignment: (employeeId: string, input: CreateAssignmentInput) =>
    apiFetch<Assignment>(`${BASE}/employees/${employeeId}/assignments`, {
      method: 'POST',
      body: input,
    }),
}
