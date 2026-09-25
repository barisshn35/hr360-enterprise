import { apiFetch } from './client'
import type {
  CreateWorkflowInput,
  DecideStepInput,
  DelegateStepInput,
  Workflow,
  WorkflowStatus,
} from './types'

const BASE = '/api/workflow'

export interface WorkflowFilters {
  status?: WorkflowStatus
  requesterId?: string
}

export const workflowApi = {
  list: (filters: WorkflowFilters = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (filters.status) params.set('status', filters.status)
    if (filters.requesterId) params.set('requesterId', filters.requesterId)
    const qs = params.toString()
    return apiFetch<Workflow[]>(`${BASE}/workflows${qs ? `?${qs}` : ''}`, { signal })
  },

  get: (id: string, signal?: AbortSignal) =>
    apiFetch<Workflow>(`${BASE}/workflows/${id}`, { signal }),

  listOverdue: (signal?: AbortSignal) =>
    apiFetch<Workflow[]>(`${BASE}/workflows/overdue`, { signal }),

  create: (input: CreateWorkflowInput) =>
    apiFetch<Workflow>(`${BASE}/workflows`, { method: 'POST', body: input }),

  decide: (workflowId: string, stepId: string, input: DecideStepInput) =>
    apiFetch<Workflow>(`${BASE}/workflows/${workflowId}/steps/${stepId}/decide`, {
      method: 'POST',
      body: input,
    }),

  delegate: (workflowId: string, stepId: string, input: DelegateStepInput) =>
    apiFetch<Workflow>(`${BASE}/workflows/${workflowId}/steps/${stepId}/delegate`, {
      method: 'POST',
      body: input,
    }),
}
