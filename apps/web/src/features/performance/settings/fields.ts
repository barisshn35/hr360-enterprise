/**
 * Puanlama ayarı alanlarının Türkçe adları, biçimi ve sürüm farkı.
 *
 * Onay penceresi ("şu alanlar değişiyor") ve sürüm geçmişindeki "neler
 * değişti" özeti aynı tabloyu kullanır.
 */

import { formatWeight, type ScoringConfig, type ScoringConfigInput } from '@/api/performance'

export type FieldKey = keyof ScoringConfigInput

interface FieldMeta {
  label: string
  group: 'split' | 'category' | 'rater' | 'validity' | 'threshold'
  format: (v: number | boolean) => string
}

const pct = (v: number | boolean) => `%${v}`
const weight = (v: number | boolean) => formatWeight(v as number)
const plain = (v: number | boolean) => String(v)
const onOff = (v: number | boolean) => (v ? 'Açık' : 'Kapalı')

export const FIELDS: Record<FieldKey, FieldMeta> = {
  goalWeightPercent: { label: 'Hedef payı', group: 'split', format: pct },
  metricWeightPercent: { label: 'Metrik payı', group: 'split', format: pct },
  technicalWeight: { label: 'Teknik kategori ağırlığı', group: 'category', format: weight },
  behavioralWeight: { label: 'Davranışsal kategori ağırlığı', group: 'category', format: weight },
  leadershipWeight: { label: 'Liderlik kategori ağırlığı', group: 'category', format: weight },
  deliveryWeight: { label: 'Teslimat kategori ağırlığı', group: 'category', format: weight },
  customWeight: { label: 'Özel kategori ağırlığı', group: 'category', format: weight },
  selfReviewWeight: { label: 'Öz değerlendirme katsayısı', group: 'rater', format: weight },
  managerReviewWeight: { label: 'Yönetici katsayısı', group: 'rater', format: weight },
  teamLeadReviewWeight: { label: 'Takım lideri katsayısı', group: 'rater', format: weight },
  peerReviewWeight: { label: 'Ekip arkadaşı katsayısı', group: 'rater', format: weight },
  upwardReviewWeight: { label: 'Yukarı yönlü katsayı', group: 'rater', format: weight },
  minReviewsForValidScore: { label: 'Geçerli puan için en az değerlendirme', group: 'validity', format: plain },
  allowSelfOnlyScore: { label: 'Yalnızca öz değerlendirmeyle puan', group: 'validity', format: onOff },
  criticalThreshold: { label: 'Kritik eşik', group: 'threshold', format: plain },
  improvementThreshold: { label: 'Gelişim eşiği', group: 'threshold', format: plain },
  recognitionThreshold: { label: 'Takdir eşiği', group: 'threshold', format: plain },
  promotionThreshold: { label: 'Terfi eşiği', group: 'threshold', format: plain },
  promotionConsecutivePeriods: { label: 'Terfi için üst üste dönem', group: 'threshold', format: plain },
}

export const FIELD_KEYS = Object.keys(FIELDS) as FieldKey[]

/** Sunucudan gelen ayardan PUT gövdesi: tüm alanlar, başka hiçbir şey. */
export function toInput(c: ScoringConfig): ScoringConfigInput {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, c[k]])) as unknown as ScoringConfigInput
}

export interface FieldChange {
  key: FieldKey
  label: string
  from: string
  to: string
  /** Sayısal alanlarda artış mı azalış mı — ok yönü için. */
  direction: 'up' | 'down' | 'toggle'
}

export function diff(before: ScoringConfigInput, after: ScoringConfigInput): FieldChange[] {
  const out: FieldChange[] = []
  for (const key of FIELD_KEYS) {
    const a = before[key]
    const b = after[key]
    if (a === b) continue
    // Metrik payı hedef payının tümleyeni; ikisini ayrı satır göstermek gürültü olur.
    if (key === 'metricWeightPercent') continue
    const meta = FIELDS[key]
    out.push({
      key,
      label: key === 'goalWeightPercent' ? 'Hedef / metrik payı' : meta.label,
      from: key === 'goalWeightPercent' ? `${a}/${100 - (a as number)}` : meta.format(a),
      to: key === 'goalWeightPercent' ? `${b}/${100 - (b as number)}` : meta.format(b),
      direction: typeof a === 'boolean' ? 'toggle' : (b as number) > (a as number) ? 'up' : 'down',
    })
  }
  return out
}
