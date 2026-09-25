/**
 * Puan motoru — backend'in anlattığı formülün mock karşılığı.
 *
 *   metrik puanı   = Σ(normalize(değer) × değerlendirici katsayısı) / Σ katsayı
 *   kategori puanı = metrik puanlarının metrik ağırlığıyla ortalaması
 *   metrik ayağı   = kategori puanlarının kategori ağırlığıyla ortalaması
 *                    (ağırlığı 0 olan kategori hesaba girmez)
 *   hedef ayağı    = hedef ilerlemelerinin hedef ağırlığıyla ortalaması
 *                    (sayısal hedefte current/target, %100'de kırpılır;
 *                     değilse Achieved=100, Missed=0, Active=50)
 *   nihai puan     = hedef × hedef payı + metrik × metrik payı
 *                    (bir ayak boşsa diğeri tam ağırlıkla kullanılır)
 *
 * Geçici puan: gönderilmiş değerlendirme sayısı `minReviewsForValidScore`'un
 * altındaysa ya da yalnızca öz değerlendirme varsa (izin verilmediyse).
 */

import { CATEGORIES, categoryWeightKey, reviewWeightKey } from '@/api/performance/labels'
import type { ConfigRow, CycleRow, Db, GoalRow, ReviewRow } from '../db'
import { departmentOf } from '../data/people'
import { round2 } from '../util'

export function currentConfig(db: Db): ConfigRow {
  return db.configs[db.configs.length - 1]
}

export function configFor(db: Db, cycle: CycleRow | undefined): ConfigRow {
  if (cycle?.status === 'Closed' && cycle.configVersion) {
    return db.configs.find((c) => c.version === cycle.configVersion) ?? currentConfig(db)
  }
  return currentConfig(db)
}

export function goalProgress(g: GoalRow): number | null {
  if (g.status === 'Cancelled') return null
  if (g.targetValue !== null && g.targetValue > 0) {
    return Math.min(100, Math.max(0, ((g.currentValue ?? 0) / g.targetValue) * 100))
  }
  switch (g.status) {
    case 'Achieved':
      return 100
    case 'Missed':
      return 0
    case 'Active':
      return 50
    default:
      return 0
  }
}

export interface ScoreWire {
  score: number | null
  goalScore: number | null
  metricScore: number | null
  isProvisional: boolean
  provisionalReason: string | null
  reviewCount: number
  configVersion: number
  goalWeightPercent: number
  metricWeightPercent: number
  breakdown: {
    categories: {
      category: string
      score: number | null
      weight: number
      metrics: { metricId: string; code: string; name: string; normalizedScore: number | null; weight: number; reviewCount: number }[]
    }[]
    goals: { goalId: string; title: string; weight: number; progress: number | null; status: string }[]
  }
}

export function submittedReviews(db: Db, employeeId: string, cycleId: string): ReviewRow[] {
  return db.reviews.filter((r) => r.employeeId === employeeId && r.cycleId === cycleId && r.submittedAt)
}

export function computeScore(db: Db, employeeId: string, cycleId: string): ScoreWire {
  const cycle = db.cycles.find((c) => c.id === cycleId)
  const cfg = configFor(db, cycle)
  const reviews = submittedReviews(db, employeeId, cycleId)
  const dept = departmentOf(employeeId)

  const scoredIds = new Set(reviews.flatMap((r) => r.scores.map((s) => s.metricId)))
  const metrics = db.metrics.filter(
    (m) => (!m.departmentId || m.departmentId === dept) && (m.isActive || scoredIds.has(m.id)),
  )

  const categories: ScoreWire['breakdown']['categories'] = []
  for (const category of CATEGORIES) {
    const inCat = metrics.filter((m) => m.category === category).sort((a, b) => a.sortOrder - b.sortOrder)
    if (!inCat.length) continue

    const rows = inCat.map((m) => {
      let sum = 0
      let wsum = 0
      let count = 0
      for (const r of reviews) {
        const s = r.scores.find((x) => x.metricId === m.id)
        if (!s) continue
        const w = cfg[reviewWeightKey[r.type]] as number
        const span = m.range.max - m.range.min || 1
        sum += ((s.value - m.range.min) / span) * 100 * w
        wsum += w
        count++
      }
      return {
        metricId: m.id,
        code: m.code,
        name: m.name,
        normalizedScore: wsum > 0 ? round2(sum / wsum) : null,
        weight: m.weight,
        reviewCount: count,
      }
    })

    const scored = rows.filter((x) => x.normalizedScore !== null)
    const wsum = scored.reduce((a, x) => a + x.weight, 0)
    const score = wsum > 0 ? round2(scored.reduce((a, x) => a + (x.normalizedScore as number) * x.weight, 0) / wsum) : null
    categories.push({ category, score, weight: cfg[categoryWeightKey[category]] as number, metrics: rows })
  }

  const counted = categories.filter((c) => c.weight > 0 && c.score !== null)
  const cwsum = counted.reduce((a, c) => a + c.weight, 0)
  const metricScore = cwsum > 0 ? round2(counted.reduce((a, c) => a + (c.score as number) * c.weight, 0) / cwsum) : null

  const goals = db.goals
    .filter((g) => g.employeeId === employeeId && g.cycleId === cycleId && g.status !== 'Cancelled')
    .map((g) => ({ goalId: g.id, title: g.title, weight: g.weight, progress: goalProgress(g), status: g.status }))
  const gwsum = goals.reduce((a, g) => a + g.weight, 0)
  const goalScore = gwsum > 0 ? round2(goals.reduce((a, g) => a + (g.progress ?? 0) * g.weight, 0) / gwsum) : 0

  let score: number | null = null
  if (reviews.length > 0) {
    const hasGoals = gwsum > 0
    if (hasGoals && metricScore !== null) {
      score = round2((goalScore * cfg.goalWeightPercent + metricScore * cfg.metricWeightPercent) / 100)
    } else if (metricScore !== null) {
      score = metricScore
    } else if (hasGoals) {
      score = goalScore
    }
  }

  let provisionalReason: string | null = null
  if (score !== null) {
    const selfOnly = reviews.every((r) => r.type === 'Self')
    if (selfOnly && !cfg.allowSelfOnlyScore) {
      provisionalReason = 'Yalnızca öz değerlendirme var; yönetici ya da ekip arkadaşı değerlendirmesi bekleniyor.'
    } else if (reviews.length < cfg.minReviewsForValidScore) {
      provisionalReason = `Yalnızca ${reviews.length} değerlendirme var; geçerli puan için en az ${cfg.minReviewsForValidScore} gerekiyor.`
    }
  }

  return {
    score,
    goalScore,
    metricScore,
    isProvisional: provisionalReason !== null,
    provisionalReason,
    reviewCount: reviews.length,
    configVersion: cfg.version,
    goalWeightPercent: cfg.goalWeightPercent,
    metricWeightPercent: cfg.metricWeightPercent,
    breakdown: { categories, goals },
  }
}

/** Dönem sıralaması: başlangıç tarihine göre. */
export function sortedCycles(db: Db): CycleRow[] {
  return [...db.cycles].sort((a, b) => a.startDate.localeCompare(b.startDate))
}

/** Değerlendirmenin "şimdiki" dönemi: açık dönem, yoksa son kapanan. */
export function currentCycle(db: Db): CycleRow | undefined {
  const cycles = sortedCycles(db)
  return cycles.find((c) => c.status === 'Open') ?? [...cycles].reverse().find((c) => c.status === 'Closed')
}

/** Bu dönemde değerlendirmesi, hedefi ya da ekip üyeliği olan çalışanlar. */
export function participantsOf(db: Db, cycle: CycleRow, employeeIds?: string[]): string[] {
  const ids = new Set<string>()
  for (const r of db.reviews) if (r.cycleId === cycle.id) ids.add(r.employeeId)
  for (const g of db.goals) if (g.cycleId === cycle.id) ids.add(g.employeeId)
  const list = [...ids]
  return employeeIds ? list.filter((id) => employeeIds.includes(id)) : list
}
