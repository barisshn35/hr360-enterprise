/**
 * Zaman serisi ve dönem sonuçları.
 *
 * Seri noktaları, çalışanın dönem puanlarından (kapanmış dönemlerde sabit,
 * açık dönemde canlı) doğrusal ara değerle üretilir ve küçük, tohumlu bir
 * dalgalanma eklenir. Son nokta her zaman canlı puana eşittir — "şu an" ile
 * puan dökümü ekranı birbirini tutar.
 */

import type { AnalyticsPeriod } from '@/api/performance/types'
import type { CycleRow, Db } from '../db'
import { hireDateOf, isFormer, nameOf } from '../data/people'
import { avg, clamp, median, rng, round2, stdev } from '../util'
import { actionLabelFor } from './recommend'
import { computeScore, participantsOf, sortedCycles } from './score'

/** Mock'un "bugün"ü — tohum verisiyle tutarlı olsun diye sabit. */
export const TODAY = new Date('2026-09-11T12:00:00Z')

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

interface Bucket {
  label: string
  /** Kovanın temsil ettiği an (ara değer için). */
  at: number
}

const PERIOD_LABEL: Record<AnalyticsPeriod, string> = {
  week: 'Son 12 hafta',
  month: 'Son 12 ay',
  quarter: 'Son 8 çeyrek',
  halfYear: 'Son 4 yarıyıl',
  year: 'Son 4 yıl',
  all: 'Tüm zamanlar',
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function bucketsFor(period: AnalyticsPeriod): Bucket[] {
  const out: Bucket[] = []
  const y = TODAY.getUTCFullYear()
  const m = TODAY.getUTCMonth()
  switch (period) {
    case 'week':
      for (let i = 11; i >= 0; i--) {
        const d = new Date(TODAY.getTime() - i * 7 * 86400000)
        out.push({ label: `Hf ${isoWeek(d)}`, at: d.getTime() })
      }
      break
    case 'month':
      for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(y, m - i, 15))
        out.push({ label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, at: d.getTime() })
      }
      break
    case 'quarter':
    case 'all': {
      const count = period === 'all' ? 11 : 8
      const q = Math.floor(m / 3)
      for (let i = count - 1; i >= 0; i--) {
        const qi = q - i
        const yy = y + Math.floor(qi / 4)
        const qq = ((qi % 4) + 4) % 4
        out.push({ label: `Q${qq + 1} ${yy}`, at: Date.UTC(yy, qq * 3 + 1, 15) })
      }
      break
    }
    case 'halfYear': {
      const h = m < 6 ? 0 : 1
      for (let i = 3; i >= 0; i--) {
        const hi = h - i
        const yy = y + Math.floor(hi / 2)
        const hh = ((hi % 2) + 2) % 2
        out.push({ label: `H${hh + 1} ${yy}`, at: Date.UTC(yy, hh * 6 + 3, 1) })
      }
      break
    }
    case 'year':
      for (let i = 3; i >= 0; i--) out.push({ label: String(y - i), at: Date.UTC(y - i, 6, 1) })
      break
  }
  // Son kova bugünü temsil eder.
  out[out.length - 1].at = Math.min(out[out.length - 1].at, TODAY.getTime())
  return out
}

interface Anchor {
  at: number
  score: number
  isProvisional: boolean
}

/** Çalışanın dönem puanlarından çapa noktaları. */
function anchorsOf(db: Db, employeeId: string): Anchor[] {
  const anchors: Anchor[] = []
  for (const c of sortedCycles(db)) {
    if (c.status === 'Planned') continue
    const s = computeScore(db, employeeId, c.id)
    if (s.score === null) continue
    const start = Date.parse(c.startDate)
    const end = Math.min(Date.parse(c.endDate), TODAY.getTime())
    anchors.push({ at: c.status === 'Open' ? TODAY.getTime() : (start + end) / 2, score: s.score, isProvisional: s.isProvisional })
  }
  return anchors
}

function valueAt(anchors: Anchor[], at: number): number | null {
  if (!anchors.length) return null
  if (at <= anchors[0].at) return anchors[0].score - Math.min(4, (anchors[0].at - at) / (86400000 * 120))
  for (let i = 1; i < anchors.length; i++) {
    const a = anchors[i - 1]
    const b = anchors[i]
    if (at <= b.at) return a.score + ((b.score - a.score) * (at - a.at)) / (b.at - a.at || 1)
  }
  return anchors[anchors.length - 1].score
}

export interface SeriesPointWire {
  bucket: string
  score: number | null
  isProvisional: boolean
  reviewCount: number
}

export function employeeSeries(db: Db, employeeId: string, period: AnalyticsPeriod): SeriesPointWire[] {
  const anchors = anchorsOf(db, employeeId)
  const buckets = bucketsFor(period)
  const hired = Date.parse(hireDateOf(employeeId) ?? '2000-01-01')
  const r = rng(`${employeeId}:${period}`)
  const last = anchors[anchors.length - 1]

  return buckets.map((b, i) => {
    const isLast = i === buckets.length - 1
    const noise = (r() - 0.5) * (period === 'week' ? 5 : 3)
    const reviewCount = Math.max(0, Math.round(1 + r() * (period === 'week' ? 2 : 6)))
    if (b.at < hired || !anchors.length) {
      return { bucket: b.label, score: null, isProvisional: false, reviewCount: 0 }
    }
    if (isLast && last && last.at === TODAY.getTime()) {
      return { bucket: b.label, score: last.score, isProvisional: last.isProvisional, reviewCount }
    }
    const v = valueAt(anchors, b.at)
    return {
      bucket: b.label,
      score: v === null ? null : round2(clamp(v + noise, 0, 100)),
      // Az değerlendirmeye dayanan kovalar geçici sayılır.
      isProvisional: reviewCount < 2,
      reviewCount,
    }
  })
}

function trendOf(series: { score: number | null }[]) {
  const values = series.map((p) => p.score).filter((v): v is number => v !== null)
  const current = values.length ? values[values.length - 1] : null
  const previous = values.length > 1 ? values[values.length - 2] : null
  const change = current !== null && previous !== null ? round2(current - previous) : null
  const base = values.length > 3 ? values[values.length - 4] : values[0]
  const span = current !== null && base !== undefined ? current - base : 0
  const trend = span >= 5 ? 'StrongUp' : span >= 1.5 ? 'Up' : span <= -5 ? 'StrongDown' : span <= -1.5 ? 'Down' : 'Stable'
  const trendLabel = {
    StrongUp: 'Belirgin yükseliş',
    Up: 'Hafif yükseliş',
    Stable: 'Yatay seyir',
    Down: 'Hafif düşüş',
    StrongDown: 'Belirgin düşüş',
  }[trend]
  return { current, change, trend: values.length > 1 ? trend : null, trendLabel: values.length > 1 ? trendLabel : null }
}

export function employeeAnalytics(db: Db, employeeId: string, period: AnalyticsPeriod) {
  const series = employeeSeries(db, employeeId, period)
  return { employeeId, period, periodLabel: PERIOD_LABEL[period], series, ...trendOf(series) }
}

export function activeMemberIds(db: Db, teamId: string): string[] {
  return db.members.filter((m) => m.teamId === teamId && !m.leftOn).map((m) => m.employeeId)
}

function teamSeries(db: Db, memberIds: string[], period: AnalyticsPeriod): SeriesPointWire[] {
  const per = memberIds.map((id) => employeeSeries(db, id, period))
  const buckets = bucketsFor(period)
  return buckets.map((b, i) => {
    const vals = per.map((s) => s[i]?.score).filter((v): v is number => v !== null && v !== undefined)
    return {
      bucket: b.label,
      score: vals.length ? round2(avg(vals) as number) : null,
      isProvisional: vals.length < 3,
      reviewCount: per.reduce((a, s) => a + (s[i]?.reviewCount ?? 0), 0),
    }
  })
}

export function vsTeam(db: Db, employeeId: string, teamId: string, period: AnalyticsPeriod) {
  const team = db.teams.find((t) => t.id === teamId)
  const own = employeeSeries(db, employeeId, period)
  const others = activeMemberIds(db, teamId)
  const ts = teamSeries(db, others, period)
  return {
    employeeId,
    teamId,
    teamName: team?.name ?? null,
    periodLabel: PERIOD_LABEL[period],
    series: own.map((p, i) => ({
      bucket: p.bucket,
      employeeScore: p.score,
      teamAverage: ts[i]?.score ?? null,
      isProvisional: p.isProvisional,
    })),
  }
}

const DIST: [number, number][] = [
  [0, 40],
  [40, 50],
  [50, 60],
  [60, 70],
  [70, 80],
  [80, 90],
  [90, 100],
]

function distribution(scores: number[]) {
  return DIST.map(([from, to]) => ({
    label: `${from}–${to}`,
    from,
    to,
    count: scores.filter((s) => s >= from && (to === 100 ? s <= to : s < to)).length,
  }))
}

const SPREAD_NOTE = 'Ekip içi farklar küçük; sıralama tek başına anlamlı değil.'

function comparison(scores: number[]) {
  const sd = stdev(scores)
  return {
    average: scores.length ? round2(avg(scores) as number) : null,
    median: scores.length ? round2(median(scores) as number) : null,
    spread: sd === null ? null : round2(sd),
    spreadNote: sd !== null && sd < 3 ? SPREAD_NOTE : scores.length > 0 && scores.length < 3 ? 'Az sayıda puan var; karşılaştırma yanıltıcı olabilir.' : null,
  }
}

function ranked(entries: { employeeId: string; score: number; isProvisional: boolean }[]) {
  return [...entries]
    .sort((a, b) => b.score - a.score)
    .map((e, i) => ({ ...e, name: nameOf(e.employeeId), rank: i + 1 }))
}

export function teamAnalytics(db: Db, teamId: string, period: AnalyticsPeriod) {
  const team = db.teams.find((t) => t.id === teamId)
  const ids = activeMemberIds(db, teamId)
  const members: { employeeId: string; score: number; isProvisional: boolean }[] = []
  const unscored: { employeeId: string; name: string }[] = []
  for (const id of ids) {
    const s = employeeSeries(db, id, period)
    const last = [...s].reverse().find((p) => p.score !== null)
    if (!last) unscored.push({ employeeId: id, name: nameOf(id) })
    else members.push({ employeeId: id, score: last.score as number, isProvisional: s[s.length - 1].isProvisional })
  }
  const scores = members.map((m) => m.score)
  return {
    teamId,
    teamName: team?.name ?? null,
    periodLabel: PERIOD_LABEL[period],
    series: teamSeries(db, ids, period),
    distribution: distribution(scores),
    members: ranked(members),
    unscored,
    comparison: comparison(scores),
  }
}

/* -------------------------------- dönem sonuçları ------------------------------ */

function scopeIds(db: Db, cycle: CycleRow, teamId?: string | null): string[] {
  if (!teamId) return participantsOf(db, cycle)
  // Dönem sonunda ekipte olan (ya da dönem içinde ayrılan) üyeler.
  const inTeam = db.members
    .filter((m) => m.teamId === teamId && m.joinedOn <= cycle.endDate && (!m.leftOn || m.leftOn >= cycle.startDate))
    .map((m) => m.employeeId)
  return [...new Set(inTeam)]
}

export function cycleResult(db: Db, cycleId: string, teamId?: string | null) {
  const cycle = db.cycles.find((c) => c.id === cycleId)
  if (!cycle) return null
  const ids = scopeIds(db, cycle, teamId)
  const members: { employeeId: string; score: number; isProvisional: boolean }[] = []
  const unscored: { employeeId: string; name: string }[] = []
  for (const id of ids) {
    const s = computeScore(db, id, cycleId)
    if (s.score === null) unscored.push({ employeeId: id, name: nameOf(id) })
    else members.push({ employeeId: id, score: s.score, isProvisional: s.isProvisional })
  }
  const scores = members.map((m) => m.score)
  return {
    cycleId,
    cycleName: cycle.name,
    teamId: teamId ?? null,
    distribution: distribution(scores),
    members: ranked(members),
    unscored,
    comparison: comparison(scores),
  }
}

export function cycleCompare(db: Db, cycleIds: string[], teamId?: string | null) {
  const cycles = cycleIds
    .map((id) => db.cycles.find((c) => c.id === id))
    .filter((c): c is CycleRow => Boolean(c))
    .sort((a, b) => a.startDate.localeCompare(b.startDate))

  const ids = new Set<string>()
  for (const c of cycles) for (const id of scopeIds(db, c, teamId)) ids.add(id)

  const rows = [...ids].map((id) => {
    const scores: Record<string, number | null> = {}
    for (const c of cycles) scores[c.id] = computeScore(db, id, c.id).score
    return { employeeId: id, name: nameOf(id), scores }
  })

  const averages: Record<string, number | null> = {}
  for (const c of cycles) {
    const vals = rows.map((r) => r.scores[c.id]).filter((v): v is number => v !== null)
    averages[c.id] = vals.length ? round2(avg(vals) as number) : null
  }

  const first = cycles[0]
  const last = cycles[cycles.length - 1]
  const moves = rows
    .map((r) => {
      const from = first ? r.scores[first.id] : null
      const to = last ? r.scores[last.id] : null
      return from !== null && to !== null && from !== undefined && to !== undefined
        ? { employeeId: r.employeeId, name: r.name, from, to, delta: round2(to - from) }
        : null
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)

  return {
    cycles: cycles.map((c) => ({ cycleId: c.id, cycleName: c.name })),
    rows: rows.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
    averages,
    improved: moves.filter((m) => m.delta >= 3).sort((a, b) => b.delta - a.delta),
    declined: moves.filter((m) => m.delta <= -3).sort((a, b) => a.delta - b.delta),
  }
}

export function employeeCycleHistory(db: Db, employeeId: string, year?: number | null) {
  const cycles = sortedCycles(db).filter((c) => c.status !== 'Planned' && (!year || c.year === year))
  const hired = hireDateOf(employeeId) ?? '2000-01-01'
  const entries = cycles
    .filter((c) => hired <= c.endDate && !(isFormer(employeeId) && participantsOf(db, c, [employeeId]).length === 0))
    .map((c) => {
      const s = computeScore(db, employeeId, c.id)
      return {
        cycleId: c.id,
        cycleName: c.name,
        period: c.period,
        score: s.score,
        isProvisional: s.isProvisional,
        isFinal: c.status === 'Closed',
        actionLabel: c.status === 'Closed' ? actionLabelFor(s.score, db, c.id) : null,
      }
    })
  return { employeeId, year: year ?? null, cycles: entries }
}
