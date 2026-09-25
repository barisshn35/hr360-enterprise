/**
 * Kural motoru — aksiyon önerileri.
 *
 * Kararı yalnızca kurallar verir; ML katmanı karara dokunmaz, yanına ek bilgi
 * koyar. Liste sırası "dikkat gerektiren önce": Acil → Gelişim → Terfi →
 * İzle → Takdir → Aksiyon gerekmiyor.
 */

import type { Db } from '../db'
import { nameOf } from '../data/people'
import { clamp, round2 } from '../util'
import { computeScore, configFor, currentConfig, sortedCycles } from './score'

export const ACTION_ORDER = ['Urgent', 'Improvement', 'PromotionCandidate', 'Watch', 'Recognition', 'NoAction'] as const
type Action = (typeof ACTION_ORDER)[number]

const ACTION_LABEL: Record<Action, string> = {
  Urgent: 'Acil aksiyon',
  Improvement: 'Gelişim planı',
  PromotionCandidate: 'Terfi adayı',
  Watch: 'İzlenmeli',
  Recognition: 'Takdir',
  NoAction: 'Aksiyon gerekmiyor',
}

const ML_NOTE = 'Kararı kural motoru verir; bu sinyaller yalnızca ek bilgidir.'
export const ML_MIN_EMPLOYEES = 8

export interface RecommendationWire {
  employeeId: string
  action: Action
  actionLabel: string
  confidence: number
  summary: string
  currentScore: number | null
  factors: { code: string; label: string; contribution: number; explanation: string }[]
  cautions: string[]
  thresholds: { promotion: number; recognition: number; improvement: number; critical: number }
  configVersion: number
  mlLayer?: { note: string; skipReason: string | null; signals: { code: string; label: string; value: string; confidenceLabel: string | null }[] }
}

/** Backend metinleri sayıyı noktalı yazıyor ("84.88 puan") — canlı örnekle aynı. */
const fmt = (n: number) => n.toFixed(2)
const pct = (n: number) => `%${Math.round(n)}`

/** Aksiyonu yalnızca puana ve eşiklere göre verir — dönem geçmişinde "aksiyon etiketi" için. */
export function actionLabelFor(score: number | null, db: Db, cycleId: string): string | null {
  if (score === null) return null
  const cycle = db.cycles.find((c) => c.id === cycleId)
  const cfg = configFor(db, cycle)
  if (score < cfg.criticalThreshold) return ACTION_LABEL.Urgent
  if (score < cfg.improvementThreshold) return ACTION_LABEL.Improvement
  if (score >= cfg.promotionThreshold) return 'Terfi eşiğinin üzerinde'
  if (score >= cfg.recognitionThreshold) return ACTION_LABEL.Recognition
  return ACTION_LABEL.NoAction
}

export function recommend(db: Db, employeeId: string, cycleId: string, withMl: boolean, mlSkip: string | null): RecommendationWire | null {
  const cfg = currentConfig(db)
  const now = computeScore(db, employeeId, cycleId)
  if (now.score === null) return null
  const s = now.score

  const thresholds = {
    promotion: cfg.promotionThreshold,
    recognition: cfg.recognitionThreshold,
    improvement: cfg.improvementThreshold,
    critical: cfg.criticalThreshold,
  }

  // Geçmiş kapanmış dönemler (yeniden eskiye).
  const cycles = sortedCycles(db)
  const idx = cycles.findIndex((c) => c.id === cycleId)
  const history = cycles
    .slice(0, idx)
    .filter((c) => c.status === 'Closed')
    .reverse()
    .map((c) => computeScore(db, employeeId, c.id).score)
  const prev = history.find((x) => x !== null) ?? null
  const delta = prev !== null ? round2(s - prev) : null

  let consecutive = s >= cfg.promotionThreshold ? 1 : 0
  if (consecutive) {
    for (const h of history) {
      if (h !== null && h >= cfg.promotionThreshold) consecutive++
      else break
    }
  }

  const goals = now.breakdown.goals
  const gw = goals.reduce((a, g) => a + g.weight, 0)
  const goalPct = gw > 0 ? goals.reduce((a, g) => a + (g.progress ?? 0) * g.weight, 0) / gw : null

  let action: Action
  if (s < cfg.criticalThreshold) action = 'Urgent'
  else if (s < cfg.improvementThreshold) action = 'Improvement'
  else if (s >= cfg.promotionThreshold && consecutive >= cfg.promotionConsecutivePeriods) action = 'PromotionCandidate'
  else if (delta !== null && delta <= -8) action = 'Watch'
  else if (s >= cfg.recognitionThreshold) action = 'Recognition'
  else action = 'NoAction'

  const negative = action === 'Urgent' || action === 'Improvement' || action === 'Watch'
  const factors: RecommendationWire['factors'] = []

  // 1) Mevcut puan
  switch (action) {
    case 'Urgent':
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: round2(clamp((cfg.criticalThreshold - s) / 4 + 1, 1, 2.5)), explanation: `${fmt(s)} puan, kritik eşiğin (${cfg.criticalThreshold}) altında.` })
      break
    case 'Improvement':
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: round2(clamp((cfg.improvementThreshold - s) / 3 + 1, 1, 2)), explanation: `${fmt(s)} puan, gelişim eşiğinin (${cfg.improvementThreshold}) altında.` })
      break
    case 'PromotionCandidate':
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: round2(clamp((s - cfg.promotionThreshold) / 2 + 1, 1, 2)), explanation: `${fmt(s)} puan, terfi eşiğinin (${cfg.promotionThreshold}) üzerinde.` })
      break
    case 'Watch':
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: -0.5, explanation: `${fmt(s)} puan henüz gelişim eşiğinin (${cfg.improvementThreshold}) üzerinde.` })
      break
    case 'Recognition':
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: round2(clamp((s - cfg.recognitionThreshold) / 5 + 1, 1, 2)), explanation: `${fmt(s)} puan, takdir eşiğinin (${cfg.recognitionThreshold}) üzerinde.` })
      break
    default:
      factors.push({ code: 'score', label: 'Mevcut puan', contribution: 1, explanation: `${fmt(s)} puan beklenen aralıkta (${cfg.improvementThreshold}–${cfg.recognitionThreshold}).` })
  }

  // 2) Süreklilik (terfi)
  if (action === 'PromotionCandidate' || (s >= cfg.promotionThreshold && consecutive < cfg.promotionConsecutivePeriods)) {
    const enough = consecutive >= cfg.promotionConsecutivePeriods
    factors.push({
      code: 'consistency',
      label: 'Süreklilik',
      contribution: enough ? 1.5 : -1,
      explanation: enough
        ? `${consecutive} dönem üst üste eşiğin üzerinde.`
        : `Eşik yalnızca ${consecutive} dönemdir aşılıyor; ${cfg.promotionConsecutivePeriods} dönem gerekiyor.`,
    })
  }

  // 3) Eğilim
  if (delta !== null) {
    const label = delta >= 5 ? 'Belirgin yükseliş' : delta >= 1.5 ? 'Hafif yükseliş' : delta <= -5 ? 'Belirgin düşüş' : delta <= -1.5 ? 'Hafif düşüş' : 'Yatay seyir'
    const mag = round2(clamp(Math.abs(delta) / 6, 0.2, 1.8))
    const supports = negative ? delta < 0 : delta > 0
    factors.push({
      code: 'trend',
      label: 'Eğilim',
      contribution: Math.abs(delta) < 1.5 ? 0.2 * (negative ? -1 : 1) : supports ? mag : -mag,
      explanation: `${label}: önceki döneme göre ${delta > 0 ? '+' : ''}${fmt(delta)} puan.`,
    })
  }

  // 4) Hedefler
  if (goalPct !== null) {
    const raw = negative ? (70 - goalPct) / 30 : (goalPct - 70) / 30
    factors.push({
      code: 'goals',
      label: 'Hedefler',
      contribution: round2(clamp(raw, -1.2, 1.2)),
      explanation: goalPct >= 99.5 ? 'Hedeflerin tamamı gerçekleşmiş.' : `Hedeflerin ${goalPct < 50 ? 'yalnızca ' : ''}${pct(goalPct)}'i gerçekleşmiş.`,
    })
  }

  // 5) Değerlendirme kapsamı
  if (now.isProvisional) {
    factors.push({ code: 'coverage', label: 'Değerlendirme kapsamı', contribution: -0.6, explanation: `${now.reviewCount} değerlendirme; puan geçici.` })
  } else if (now.reviewCount >= 3) {
    factors.push({ code: 'coverage', label: 'Değerlendirme kapsamı', contribution: 0.4, explanation: `${now.reviewCount} farklı değerlendirmeden geliyor.` })
  }

  const cautions: string[] = []
  if (now.isProvisional && now.provisionalReason) cautions.push(`Puan geçici: ${now.provisionalReason}`)
  if (prev === null) cautions.push('Tek dönem verisi var; eğilim çıkarılamıyor.')
  if (goalPct === null) cautions.push('Bu dönem için tanımlı hedef yok; puan yalnızca metriklerden geliyor.')
  if (action === 'Watch') cautions.push('Düşüş tek döneme dayanıyor; bir sonraki değerlendirmeyi beklemeden görüşme önerilir.')
  if (action === 'PromotionCandidate' && goalPct !== null && goalPct < 70) cautions.push('Hedef gerçekleşmesi puana göre zayıf; terfi görüşmesinde ele alınmalı.')

  const supportive = factors.filter((f) => f.contribution > 0).length
  const confidence = round2(clamp(0.55 + supportive * 0.08 - (now.isProvisional ? 0.2 : 0) - (prev === null ? 0.1 : 0), 0.3, 0.95))

  const summaries: Record<Action, string> = {
    Urgent: `${fmt(s)} puan kritik eşiğin altında${delta !== null && delta < 0 ? ' ve düşüşte' : ''}.`,
    Improvement: `${fmt(s)} puan gelişim eşiğinin (${cfg.improvementThreshold}) altında.`,
    PromotionCandidate: `${fmt(s)} puanla ${consecutive} dönemdir eşiğin üzerinde.`,
    Watch: `Puan önceki döneme göre ${fmt(Math.abs(delta ?? 0))} düştü; yakından izlenmeli.`,
    Recognition: `${fmt(s)} puan takdir eşiğinin üzerinde.`,
    NoAction: `${fmt(s)} puan beklenen aralıkta.`,
  }

  const rec: RecommendationWire = {
    employeeId,
    action,
    actionLabel: ACTION_LABEL[action],
    confidence,
    summary: summaries[action],
    currentScore: s,
    factors,
    cautions,
    thresholds,
    configVersion: cfg.version,
  }

  if (withMl) {
    if (mlSkip) {
      rec.mlLayer = { note: ML_NOTE, skipReason: mlSkip, signals: [] }
    } else {
      const slope = delta ?? 0
      const projected = clamp(s + slope * 0.6 * 2, 0, 100)
      rec.mlLayer = {
        note: ML_NOTE,
        skipReason: null,
        signals: [
          {
            code: 'trajectory',
            label: 'Yörünge',
            value: `2 dönem sonra ~${Math.round(projected)}`,
            confidenceLabel: prev === null ? 'düşük' : Math.abs(slope) > 6 ? 'orta' : 'yüksek',
          },
          {
            code: 'peers',
            label: 'Benzer profiller',
            value:
              slope >= 0
                ? `Benzer ${6 + (Math.round(s) % 4)} çalışanın çoğu sonraki dönemde yükseldi`
                : `Benzer profillerin yarısı sonraki dönemde toparlandı`,
            confidenceLabel: 'orta',
          },
        ],
      }
    }
  }

  return rec
}

export function recommendAll(db: Db, employeeIds: string[], cycleId: string, withMl: boolean, mlSkip: string | null) {
  const items = employeeIds
    .map((id) => recommend(db, id, cycleId, withMl, mlSkip))
    .filter((r): r is RecommendationWire => r !== null)
    .map((r) => ({ ...r, employeeName: nameOf(r.employeeId) }))
  return items.sort((a, b) => {
    const d = ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action)
    if (d !== 0) return d
    // Aynı türde: dikkat gerektirenlerde düşük puan önce, olumlularda yüksek puan önce.
    const neg = a.action === 'Urgent' || a.action === 'Improvement' || a.action === 'Watch'
    return neg ? (a.currentScore ?? 0) - (b.currentScore ?? 0) : (b.currentScore ?? 0) - (a.currentScore ?? 0)
  })
}
