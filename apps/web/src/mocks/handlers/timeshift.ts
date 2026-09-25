/**
 * Puantaj servisi — vardiya motoru uçları (`/api/timeshift/shift-*`).
 *
 * Örnek veri 7/24 kapsamayı gösterecek şekilde kurulu: A, B ve C ekipleri
 * aynı "3 gece → 3 tatil → 3 gündüz" desenini üç gün arayla takip ediyor, yani
 * her gün bir ekip gecede, biri gündüzde, biri tatilde. Üstüne onaylı izinler
 * (Leave), bir resmî tatil (Holiday) ve bir vardiya değişimi (Manual) biniyor.
 *
 * Yetki canlıdakiyle aynı: yazma uçları yalnızca hr-admin; okuma herkese açık.
 * Veri kendi sessionStorage anahtarında durur (performans tohumuna dokunmaz);
 * `?sifirla=1` ve senaryo değişimi burada da tohumu yeniden kurar.
 */

import { HttpResponse, http } from 'msw'
import { DEPT, EMP, EMPLOYEES } from '../data/people'
import { readScenario, type Scenario } from '../scenario'
import { readMockRole } from '../session'
import { bad, forbidden, latency, newId, noContent, notFound, ok, readJson, serverError, today, uid } from '../util'

const T = '/api/timeshift'

/* ------------------------------------- Tipler ------------------------------------- */

type DayType = 'Day' | 'Night' | 'Off'
type OverrideType = 'Leave' | 'Holiday' | 'Manual'

interface PatternRow {
  id: string
  name: string
  isActive: boolean
  days: Array<{ type: DayType; startTime: string | null; endTime: string | null }>
}

interface TeamRow {
  id: string
  name: string
  shiftPatternId: string
  anchorDate: string
  departmentId: string | null
}

interface MemberRow {
  id: string
  teamId: string
  employeeId: string
  rank: number
  tag: string | null
  effectiveFrom: string
  effectiveTo: string | null
}

interface OverrideRow {
  employeeId: string | null // null → herkes (resmî tatil)
  from: string
  to: string
  type: OverrideType
  note: string
}

interface Store {
  schema: number
  scenario: Scenario
  patterns: PatternRow[]
  teams: TeamRow[]
  members: MemberRow[]
  overrides: OverrideRow[]
}

/* ------------------------------------- Tarih ------------------------------------- */

const DAY_MS = 86_400_000
const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const addDays = (iso: string, n: number) => new Date(toUtc(iso) + n * DAY_MS).toISOString().slice(0, 10)
const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(toUtc(v))
const isTime = (v: unknown): v is string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v)
/** "21:00" → "21:00:00" (backend TimeSpan biçimi) */
const wireTime = (t: string | null) => (t ? (t.length === 5 ? `${t}:00` : t) : null)

/* ------------------------------------- Tohum ------------------------------------- */

const P = {
  n3o3d3: uid('shiftpat', '3-3-3'),
  d2n2o4: uid('shiftpat', '2-2-4'),
  weekday: uid('shiftpat', '5-2'),
}

const TEAM = {
  a: uid('shiftteam', 'a'),
  b: uid('shiftteam', 'b'),
  c: uid('shiftteam', 'c'),
  support: uid('shiftteam', 'destek'),
}

const d = (type: DayType, start?: string, end?: string) => ({
  type,
  startTime: type === 'Off' ? null : wireTime(start ?? null),
  endTime: type === 'Off' ? null : wireTime(end ?? null),
})
const times = (type: DayType, n: number, start?: string, end?: string) => Array.from({ length: n }, () => d(type, start, end))

function seed(scenario: Scenario): Omit<Store, 'schema' | 'scenario'> {
  if (scenario === 'bos') return { patterns: [], teams: [], members: [], overrides: [] }

  const patterns: PatternRow[] = [
    {
      id: P.n3o3d3,
      name: '3 Gece / 3 Tatil / 3 Gündüz',
      isActive: true,
      days: [...times('Night', 3, '21:00', '09:00'), ...times('Off', 3), ...times('Day', 3, '09:00', '21:00')],
    },
    {
      id: P.d2n2o4,
      name: '2 Gündüz / 2 Gece / 4 Tatil',
      isActive: true,
      days: [...times('Day', 2, '07:00', '19:00'), ...times('Night', 2, '19:00', '07:00'), ...times('Off', 4)],
    },
    {
      id: P.weekday,
      name: 'Hafta İçi Gündüz (5/2)',
      isActive: true,
      days: [...times('Day', 5, '08:30', '17:30'), ...times('Off', 2)],
    },
  ]

  // A gecedeyken B gündüzde, C tatilde: B desende 6, C 3 gün öndedir.
  const anchorA = '2026-01-01'
  const teams: TeamRow[] = [
    { id: TEAM.a, name: 'A Ekibi', shiftPatternId: P.n3o3d3, anchorDate: anchorA, departmentId: DEPT.yazilim },
    { id: TEAM.b, name: 'B Ekibi', shiftPatternId: P.n3o3d3, anchorDate: addDays(anchorA, -6), departmentId: DEPT.yazilim },
    { id: TEAM.c, name: 'C Ekibi', shiftPatternId: P.n3o3d3, anchorDate: addDays(anchorA, -3), departmentId: DEPT.yazilim },
    // Pazartesi başlayan hafta içi deseni.
    { id: TEAM.support, name: 'Satış Destek', shiftPatternId: P.weekday, anchorDate: '2026-01-05', departmentId: DEPT.satis },
  ]

  const m = (teamId: string, key: keyof typeof EMP, rank: number, tag: string | null, from = '2026-01-01'): MemberRow => ({
    id: uid('shiftmember', `${teamId}:${key}`),
    teamId,
    employeeId: EMP[key],
    rank,
    tag,
    effectiveFrom: from,
    effectiveTo: null,
  })

  const members: MemberRow[] = [
    m(TEAM.a, 'mert', 1, 'Ekip Lideri'),
    m(TEAM.a, 'ayse', 2, 'Kıdemli Operatör'),
    m(TEAM.a, 'elif', 3, null),
    m(TEAM.a, 'tolga', 4, 'Stajyer', '2026-07-01'),
    m(TEAM.b, 'kaan', 1, 'Ekip Lideri'),
    m(TEAM.b, 'burak', 2, null),
    m(TEAM.b, 'seda', 3, null),
    m(TEAM.c, 'baris', 1, 'Ekip Lideri'),
    m(TEAM.c, 'hakan', 2, 'Kıdemli Operatör'),
    m(TEAM.c, 'gizem', 3, null),
    // Yeni katıldı: katılım öncesi günler takvimde boş kalır.
    m(TEAM.c, 'zeynep', 4, null, addDays(today(), 3)),
    m(TEAM.support, 'can', 1, 'Vardiya Amiri'),
    m(TEAM.support, 'ece', 2, null),
    m(TEAM.support, 'pinar', 3, null),
  ]

  const t = today()
  const overrides: OverrideRow[] = [
    { employeeId: EMP.elif, from: addDays(t, 2), to: addDays(t, 4), type: 'Leave', note: 'Yıllık izin (onaylı talep)' },
    { employeeId: EMP.hakan, from: addDays(t, -3), to: addDays(t, -2), type: 'Leave', note: 'Hastalık izni' },
    { employeeId: EMP.ece, from: addDays(t, 7), to: addDays(t, 11), type: 'Leave', note: 'Yıllık izin (onaylı talep)' },
    { employeeId: EMP.burak, from: addDays(t, 5), to: addDays(t, 5), type: 'Manual', note: 'Vardiya değişimi — Seda Koç ile yer değiştirdi' },
    { employeeId: null, from: '2026-10-29', to: '2026-10-29', type: 'Holiday', note: 'Cumhuriyet Bayramı' },
    { employeeId: null, from: '2027-01-01', to: '2027-01-01', type: 'Holiday', note: 'Yılbaşı' },
  ]

  return { patterns, teams, members, overrides }
}

/* ------------------------------------- Depo ------------------------------------- */

const KEY = 'hr360.mock.vardiya'
const SCHEMA = 1
let store: Store | null = null

/** Mock başlarken çağrılır: `?sifirla` / `?senaryo` uygulama adresi değiştirmeden okunmalı. */
export function getStore(): Store {
  const scenario = readScenario()
  if (store && store.scenario === scenario) return store
  let stored: Store | null = null
  try {
    const raw = window.sessionStorage.getItem(KEY)
    stored = raw ? (JSON.parse(raw) as Store) : null
  } catch {
    stored = null
  }
  const reset = new URLSearchParams(window.location.search).get('sifirla') === '1'
  store =
    stored && stored.schema === SCHEMA && stored.scenario === scenario && !reset
      ? stored
      : { schema: SCHEMA, scenario, ...seed(scenario) }
  persist()
  return store
}

function persist() {
  try {
    if (store) window.sessionStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* depolama kapalı — bellekte devam */
  }
}

/* ------------------------------------- Tel şekli ------------------------------------- */

const patternWire = (p: PatternRow) => ({
  id: p.id,
  name: p.name,
  isActive: p.isActive,
  days: p.days.map((x, i) => ({ dayIndex: i, ...x })),
})

const memberWire = (m: MemberRow) => ({
  id: m.id,
  employeeId: m.employeeId,
  rank: m.rank,
  tag: m.tag,
  effectiveFrom: m.effectiveFrom,
  effectiveTo: m.effectiveTo,
})

function teamWire(t: TeamRow) {
  const s = getStore()
  const p = s.patterns.find((x) => x.id === t.shiftPatternId)
  return {
    id: t.id,
    name: t.name,
    shiftPatternId: t.shiftPatternId,
    shiftPattern: p ? patternWire(p) : null,
    anchorDate: t.anchorDate,
    departmentId: t.departmentId,
    members: s.members.filter((m) => m.teamId === t.id && !m.effectiveTo).map(memberWire),
  }
}

/* ------------------------------------- Yardımcılar ------------------------------------- */

const canWrite = () => readMockRole() === 'hr-admin'
const denied = () => forbidden('Bu işlem yalnızca İK yöneticisi (hr-admin) tarafından yapılabilir.')
const failIfScenario = () => (readScenario() === 'hata' ? serverError('Puantaj servisi şu an yanıt vermiyor.') : null)
const conflict = (message: string) => HttpResponse.json({ message }, { status: 409 })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/* ------------------------------------- Uçlar ------------------------------------- */

export const timeshiftHandlers = [
  http.get(`${T}/shift-patterns`, async () => {
    await latency()
    return failIfScenario() ?? ok(getStore().patterns.map(patternWire))
  }),

  http.post(`${T}/shift-patterns`, async ({ request }) => {
    await latency()
    if (!canWrite()) return denied()
    const body = await readJson(request)
    const name = str(body.name)
    if (!name) return bad('Desen adı zorunludur.')
    const raw = Array.isArray(body.days) ? (body.days as Array<Record<string, unknown>>) : []
    if (raw.length === 0) return bad('Desende en az bir gün olmalıdır.')
    const days: PatternRow['days'] = []
    for (const [i, x] of raw.entries()) {
      const type = x.type as DayType
      if (!['Day', 'Night', 'Off'].includes(type)) return bad(`${i + 1}. gün: geçersiz tip.`)
      if (type === 'Off') {
        days.push({ type, startTime: null, endTime: null })
        continue
      }
      if (!isTime(x.startTime) || !isTime(x.endTime)) return bad(`${i + 1}. gün: başlangıç ve bitiş saati zorunludur.`)
      days.push({ type, startTime: wireTime(x.startTime), endTime: wireTime(x.endTime) })
    }
    const s = getStore()
    const row: PatternRow = { id: newId(), name, isActive: true, days }
    s.patterns.push(row)
    persist()
    return ok(patternWire(row), 201)
  }),

  http.delete(`${T}/shift-patterns/:id`, async ({ params }) => {
    await latency()
    if (!canWrite()) return denied()
    const s = getStore()
    const idx = s.patterns.findIndex((p) => p.id === params.id)
    if (idx < 0) return notFound('Desen bulunamadı.')
    if (s.teams.some((t) => t.shiftPatternId === params.id)) return conflict('Bu desen en az bir ekip tarafından kullanılıyor.')
    s.patterns.splice(idx, 1)
    persist()
    return noContent()
  }),

  http.get(`${T}/shift-teams`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const departmentId = new URL(request.url).searchParams.get('departmentId')
    const teams = getStore().teams.filter((t) => !departmentId || t.departmentId === departmentId)
    return ok(teams.map(teamWire))
  }),

  http.post(`${T}/shift-teams`, async ({ request }) => {
    await latency()
    if (!canWrite()) return denied()
    const body = await readJson(request)
    const s = getStore()
    const name = str(body.name)
    if (!name) return bad('Ekip adı zorunludur.')
    if (!s.patterns.some((p) => p.id === body.shiftPatternId)) return bad('Desen bulunamadı.')
    if (!isDate(body.anchorDate)) return bad('Başlangıç tarihi geçersiz.')
    const row: TeamRow = {
      id: newId(),
      name,
      shiftPatternId: String(body.shiftPatternId),
      anchorDate: body.anchorDate.slice(0, 10),
      departmentId: typeof body.departmentId === 'string' && body.departmentId ? body.departmentId : null,
    }
    s.teams.push(row)
    persist()
    return ok(teamWire(row), 201)
  }),

  http.post(`${T}/shift-teams/:id/members`, async ({ params, request }) => {
    await latency()
    if (!canWrite()) return denied()
    const s = getStore()
    const team = s.teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    const body = await readJson(request)
    const employeeId = str(body.employeeId)
    if (!EMPLOYEES.some((e) => e.id === employeeId)) return bad('Çalışan bulunamadı.')
    const rank = Number(body.rank)
    if (!Number.isInteger(rank) || rank < 1) return bad('Sıra 1 ya da daha büyük bir tam sayı olmalıdır.')
    if (!isDate(body.effectiveFrom)) return bad('Başlangıç tarihi geçersiz.')
    if (s.members.some((m) => m.teamId === team.id && m.employeeId === employeeId && !m.effectiveTo))
      return conflict('Çalışan bu ekipte zaten etkin üye.')
    // Başka bir ekipteki etkin üyelik kendiliğinden kapanır.
    for (const m of s.members) if (m.employeeId === employeeId && !m.effectiveTo) m.effectiveTo = today()
    const row: MemberRow = {
      id: newId(),
      teamId: team.id,
      employeeId,
      rank,
      tag: str(body.tag) || null,
      effectiveFrom: body.effectiveFrom.slice(0, 10),
      effectiveTo: null,
    }
    s.members.push(row)
    persist()
    return ok(memberWire(row), 201)
  }),

  http.delete(`${T}/shift-teams/:id/members/:memberId`, async ({ params }) => {
    await latency()
    if (!canWrite()) return denied()
    const s = getStore()
    const m = s.members.find((x) => x.id === params.memberId && x.teamId === params.id && !x.effectiveTo)
    if (!m) return notFound('Etkin üyelik bulunamadı.')
    m.effectiveTo = today()
    persist()
    return noContent()
  }),

  http.get(`${T}/shift-teams/:id/roster`, async ({ params, request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const s = getStore()
    const team = s.teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to) || diffDays(from, to) < 0) return bad('Geçerli bir tarih aralığı verin (from ≤ to).')
    if (diffDays(from, to) > 92) return bad('Takvim en fazla 93 gün için hesaplanabilir.')

    const pattern = s.patterns.find((p) => p.id === team.shiftPatternId)
    const len = pattern?.days.length ?? 0
    const dates = Array.from({ length: diffDays(from, to) + 1 }, (_, i) => addDays(from, i))

    const members = s.members
      .filter((m) => m.teamId === team.id && !m.effectiveTo)
      .sort((a, b) => a.rank - b.rank || a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map((m) => ({
        employeeId: m.employeeId,
        rank: m.rank,
        tag: m.tag,
        schedule: dates
          .filter((date) => date >= m.effectiveFrom)
          .map((date) => {
            const o = s.overrides.find(
              (x) => (x.employeeId === null || x.employeeId === m.employeeId) && date >= x.from && date <= x.to,
            )
            if (o) return { date, type: o.type, note: o.note }
            if (!pattern || len === 0) return { date, type: 'Off' as const }
            const day = pattern.days[((diffDays(team.anchorDate, date) % len) + len) % len]
            return day.type === 'Off'
              ? { date, type: 'Off' as const }
              : { date, type: day.type, startTime: day.startTime, endTime: day.endTime }
          }),
      }))

    return ok({ team: team.name, patternName: pattern?.name ?? '—', members })
  }),
]
