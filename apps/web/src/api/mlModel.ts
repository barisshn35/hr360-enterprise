import { apiFetch } from './client'

/**
 * Devir riski modelinin şeffaflık uçları (G5): model kartı, küresel özellik önemi ve veri kayması.
 * Gateway /ml/model/* yollarını ml-inference'a iletir; uçlar Keycloak jetonu ve İK rolü ister.
 * Kişi bazlı tahmin (/ml/predict, /ml/explain) gateway'de kapalıdır - governance üzerinden yapılır.
 */
const BASE = '/ml/model'

export interface ModelFeature {
  name: string
  label: string
  unit: string
  description: string
  min: number
  max: number
}

export interface ModelMetrics {
  auc: number
  accuracy: number
  n: number
  positive_rate: number
}

export interface ModelCard {
  model: string
  loaded: boolean
  serving: boolean
  blocked_reason: string | null
  version: string | null
  trained_at: string | null
  training_source: 'synthetic' | 'provided' | null
  training_rows: number | null
  data_window: { start: string; end: string } | null
  data_window_note: string | null
  evaluation_source: string | null
  evaluation_rows: number | null
  metrics: ModelMetrics | null
  algorithm: Record<string, string | number>
  features: ModelFeature[]
  excluded_attributes: Array<{ key: string; label: string }>
  excluded_check: { passed: boolean; violations: Array<{ feature: string; attribute: string }> }
  promotion: { promote: boolean; reason: string; auc_delta: number | null; compared_with_version: string | null } | null
  drift_thresholds: { moderate: number; significant: number }
  promotion_tolerance: number
  intended_use: string
  limitations: string[]
  fairness: { note: string; residual_risk: string }
  kvkk: string
}

export interface FeatureImportance {
  model: string
  version: string
  method: 'mean_abs_shap' | 'impurity'
  sample_rows: number
  features: Array<{ feature: string; label: string; value: number; share: number }>
}

export type DriftLevel = 'stable' | 'moderate' | 'significant'

export interface DriftReport {
  available: boolean
  rows?: number
  min_rows?: number
  source?: 'batch' | 'recent-predictions'
  model_version?: string
  computed_at?: string
  max_psi?: number
  status?: DriftLevel
  significant_features?: string[]
  recommendation?: string
  features?: Array<{ feature: string; label: string; psi: number; level: DriftLevel; reference_mean: number | null; batch_mean: number | null }>
}

export interface RetrainResult {
  candidate_version: string
  promoted: boolean
  decision: { promote: boolean; reason: string; auc_delta: number | null }
  candidate: ModelMetrics
  current: ModelMetrics | null
  serving_version: string
}

export const mlModelApi = {
  card: (signal?: AbortSignal) => apiFetch<ModelCard>(`${BASE}/card`, { signal }),
  importance: (signal?: AbortSignal) => apiFetch<FeatureImportance>(`${BASE}/importance`, { signal }),
  /** Son tahmin girdilerinin toplu histogramından (kiracı başına) PSI. */
  recentDrift: (signal?: AbortSignal) => apiFetch<DriftReport>(`${BASE}/drift/recent`, { signal }),
  /** Son kaydedilen kayma ölçümü (toplu satır gönderimi ya da son tahminler). */
  lastDrift: (signal?: AbortSignal) => apiFetch<DriftReport>(`${BASE}/drift/last`, { signal }),
  /** Sentetik veriyle yeni tohumla yeniden eğitim (İK). Aday, mevcut modelden kötü değilse yayımlanır. */
  retrainSynthetic: () =>
    // governance üzerinden: eğitim özeti denetim kaydına yazılır.
    apiFetch<RetrainResult>('/api/governance/model/retrain', { method: 'POST', body: {} }),
}
