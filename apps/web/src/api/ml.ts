import { apiFetch } from './client'
import type { ExplainResponse, MlHealth, PredictResponse } from './types'

export const mlApi = {
  health: (signal?: AbortSignal) => apiFetch<MlHealth>('/ml/health', { signal, anonymous: true }),

  predict: (features: number[]) =>
    apiFetch<PredictResponse>('/ml/predict', { method: 'POST', body: { features } }),

  explain: (features: number[]) =>
    apiFetch<ExplainResponse>('/ml/explain', { method: 'POST', body: { features } }),
}

export const gatewayApi = {
  health: (signal?: AbortSignal) =>
    apiFetch<{ status: string; service: string }>('/gateway/health', { signal, anonymous: true }),
}
