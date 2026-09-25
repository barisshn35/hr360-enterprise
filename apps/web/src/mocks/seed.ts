/**
 * Tohum verisi. Değerlendirme puanları rastgele değil: her çalışanın dönem
 * başına bir "hedef profili" var ve puanlar o profile göre, tohumlu PRNG ile
 * üretiliyor. Sonuç her yüklemede aynı, ama ekranlar gerçekçi dağılım görür:
 *
 *   Ayşe   → 2 dönemdir terfi eşiğinin üzerinde  → Terfi adayı
 *   Burak  → kritik eşiğin altında, düşüşte      → Acil aksiyon
 *   Zeynep → gelişim eşiğinin altında            → Gelişim planı
 *   Kaan   → önceki döneme göre sert düşüş       → İzlenmeli
 *   Elif, Barış → takdir eşiğinin üzerinde       → Takdir
 *   Gizem  → tek değerlendirme                   → geçici puan
 *   Hakan  → yalnızca öz değerlendirme           → geçici puan
 *   Tolga, Sena → hiç değerlendirme yok          → puansız
 */

import type { CyclePeriod, GoalStatus, MetricCategory, MetricScale, ReviewType } from '@/api/performance/types'
import { DEFAULT_REVIEW_WEIGHTS, scaleRange } from '@/api/performance/labels'
import type { ConfigRow, CycleRow, Db, FeedbackRow, GoalRow, MemberRow, MetricRow, ReviewRow, TeamRow } from './db'
import { DEPT, EMP, hireDateOf, type PersonKey } from './data/people'
import type { Scenario } from './scenario'
import { clamp, rng, slugify, uid } from './util'

/* ----------------------------------- Metrikler ---------------------------------- */

interface MetricSeed {
  name: string
  description: string
  category: MetricCategory
  scale: MetricScale
  weight: number
  dept?: keyof typeof DEPT
  required?: boolean
  archived?: boolean
}

const METRICS: MetricSeed[] = [
  { name: 'Kod kalitesi', description: 'Okunabilirlik, test kapsamı ve inceleme geri bildirimlerine göre kod kalitesi.', category: 'Technical', scale: 'OneToFive', weight: 2.5, dept: 'yazilim', required: true },
  { name: 'Teknik derinlik', description: 'Karmaşık problemlerde çözüm üretme ve sistemi uçtan uca kavrama.', category: 'Technical', scale: 'OneToFive', weight: 2, dept: 'yazilim' },
  { name: 'Test kapsamı', description: 'Yazılan kodun otomatik testlerle kapsanma oranı.', category: 'Technical', scale: 'Percentage', weight: 1.5, dept: 'yazilim' },
  { name: 'Zamanında teslim', description: 'Taahhüt edilen işlerin söz verilen tarihte teslim edilmesi.', category: 'Delivery', scale: 'OneToTen', weight: 2, required: true },
  { name: 'Teslimat öngörülebilirliği', description: 'Tahminlerin gerçekleşmeyle ne kadar örtüştüğü.', category: 'Delivery', scale: 'OneToFive', weight: 1 },
  { name: 'Hedef gerçekleşme oranı', description: 'Dönem satış kotasının gerçekleşme yüzdesi.', category: 'Delivery', scale: 'Percentage', weight: 3, dept: 'satis', required: true },
  { name: 'İletişim', description: 'Açık, zamanında ve doğru kanaldan iletişim.', category: 'Behavioral', scale: 'OneToFive', weight: 1, required: true },
  { name: 'İş birliği', description: 'Ekip içi ve ekipler arası birlikte çalışma.', category: 'Behavioral', scale: 'OneToFive', weight: 1.5 },
  { name: 'Müşteri memnuniyeti', description: 'Müşteri geri bildirimleri ve yenileme oranları.', category: 'Behavioral', scale: 'OneToTen', weight: 2, dept: 'satis' },
  { name: 'Mentorluk', description: 'Ekip arkadaşlarının gelişimine katkı.', category: 'Leadership', scale: 'OneToFive', weight: 1 },
  { name: 'Sorumluluk alma', description: 'Sahipsiz kalan işleri üstlenme ve sonuna kadar götürme.', category: 'Leadership', scale: 'OneToTen', weight: 1 },
  { name: 'Şirket değerlerine uyum', description: 'Acme değerlerinin günlük işe yansıması.', category: 'Custom', scale: 'OneToFive', weight: 1 },
  { name: 'Mesai uyumu', description: 'Çalışma saatlerine uyum. 2026 başında arşivlendi.', category: 'Behavioral', scale: 'OneToFive', weight: 1, archived: true },
]

function buildMetrics(): MetricRow[] {
  const order: Record<MetricCategory, number> = { Technical: 0, Behavioral: 1, Leadership: 2, Delivery: 3, Custom: 4 }
  const counters: Record<string, number> = {}
  return METRICS.map((m) => {
    counters[m.category] = (counters[m.category] ?? 0) + 1
    const code = slugify(m.name)
    return {
      id: uid('metric', code),
      code,
      name: m.name,
      description: m.description,
      category: m.category,
      scale: m.scale,
      weight: m.weight,
      departmentId: m.dept ? DEPT[m.dept] : null,
      isRequired: Boolean(m.required),
      isActive: !m.archived,
      sortOrder: order[m.category] * 10 + counters[m.category],
      range: { ...scaleRange[m.scale] },
    }
  })
}

/* --------------------------------- Puanlama ayarı ------------------------------- */

const BASE_CONFIG = {
  minReviewsForValidScore: 2,
  allowSelfOnlyScore: false,
  criticalThreshold: 40,
  improvementThreshold: 55,
  recognitionThreshold: 75,
  promotionThreshold: 85,
  promotionConsecutivePeriods: 2,
  selfReviewWeight: DEFAULT_REVIEW_WEIGHTS.Self,
  managerReviewWeight: DEFAULT_REVIEW_WEIGHTS.Manager,
  teamLeadReviewWeight: DEFAULT_REVIEW_WEIGHTS.TeamLead,
  peerReviewWeight: DEFAULT_REVIEW_WEIGHTS.Peer,
  upwardReviewWeight: DEFAULT_REVIEW_WEIGHTS.Upward,
}

function buildConfigs(): ConfigRow[] {
  return [
    {
      id: uid('config', '1'), version: 1, createdAt: '2025-06-02T08:30:00Z', createdBy: 'Derya Aksoy',
      ...BASE_CONFIG,
      goalWeightPercent: 40, metricWeightPercent: 60,
      technicalWeight: 1, behavioralWeight: 1, leadershipWeight: 1, deliveryWeight: 1, customWeight: 1,
    },
    {
      id: uid('config', '2'), version: 2, createdAt: '2026-03-28T14:05:00Z', createdBy: 'Derya Aksoy',
      ...BASE_CONFIG,
      goalWeightPercent: 30, metricWeightPercent: 70,
      technicalWeight: 2.5, behavioralWeight: 1.5, leadershipWeight: 1, deliveryWeight: 2, customWeight: 1,
    },
    {
      id: uid('config', '3'), version: 3, createdAt: '2026-06-30T09:12:00Z', createdBy: 'Emre Polat',
      ...BASE_CONFIG,
      goalWeightPercent: 40, metricWeightPercent: 60,
      // Özel kategori 0: "Şirket değerlerine uyum" puanlanıyor ama hesaba girmiyor.
      technicalWeight: 2.5, behavioralWeight: 1.5, leadershipWeight: 1, deliveryWeight: 2, customWeight: 0,
    },
  ]
}

/* ------------------------------------ Dönemler ---------------------------------- */

interface CycleSeed {
  key: string
  name: string
  year: number
  period: CyclePeriod
  status: CycleRow['status']
  start: string
  end: string
  configVersion: number | null
}

const CYCLES: CycleSeed[] = [
  { key: '2025-h2', name: '2025 2. Yarıyıl', year: 2025, period: 'H2', status: 'Closed', start: '2025-07-01', end: '2025-12-31', configVersion: 1 },
  { key: '2026-q1', name: '2026 1. Çeyrek', year: 2026, period: 'Q1', status: 'Closed', start: '2026-01-01', end: '2026-03-31', configVersion: 1 },
  { key: '2026-q2', name: '2026 2. Çeyrek', year: 2026, period: 'Q2', status: 'Closed', start: '2026-04-01', end: '2026-06-30', configVersion: 2 },
  { key: '2026-q3', name: '2026 3. Çeyrek', year: 2026, period: 'Q3', status: 'Open', start: '2026-07-01', end: '2026-09-30', configVersion: null },
  { key: '2026-q4', name: '2026 4. Çeyrek', year: 2026, period: 'Q4', status: 'Planned', start: '2026-10-01', end: '2026-12-31', configVersion: null },
]

export const CYCLE_ID = Object.fromEntries(CYCLES.map((c) => [c.key, uid('cycle', c.key)])) as Record<string, string>

/* ------------------------------------ Profiller --------------------------------- */

type Plan = 'full' | 'one' | 'self' | 'none'

interface Profile {
  /** Dönem anahtarı → hedef puan (null: o dönem çalışmıyordu / değerlendirilmedi). */
  targets: Partial<Record<string, number>>
  /** Açık dönemdeki değerlendirme kapsamı. */
  plan?: Plan
  /** Açık dönemde hedefi yok — "hedef ayağı boş" dipnotunu göstermek için. */
  noGoals?: boolean
}

const T = (h2: number | null, q1: number | null, q2: number | null, q3: number | null) => {
  const out: Partial<Record<string, number>> = {}
  if (h2 !== null) out['2025-h2'] = h2
  if (q1 !== null) out['2026-q1'] = q1
  if (q2 !== null) out['2026-q2'] = q2
  if (q3 !== null) out['2026-q3'] = q3
  return out
}

const PROFILES: Record<PersonKey, Profile> = {
  mert: { targets: T(74, 76, 77, 78) },
  ayse: { targets: T(80, 84, 89, 91) },
  elif: { targets: T(66, 68, 71, 78) },
  burak: { targets: T(58, 52, 45, 35) },
  zeynep: { targets: T(60, 58, 57, 51) },
  kaan: { targets: T(80, 81, 80, 63) },
  seda: { targets: T(70, 71, 69, 70), noGoals: true },
  baris: { targets: T(78, 80, 83, 82) },
  gizem: { targets: T(null, 70, 73, 72), plan: 'one' },
  hakan: { targets: T(62, 60, 59, 58), plan: 'self' },
  tolga: { targets: T(null, null, null, null), plan: 'none' },
  sena: { targets: T(null, null, null, null), plan: 'none' },
  oguz: { targets: T(70, 68, null, null) },
  emre: { targets: T(82, 83, 83, 84) },
  can: { targets: T(73, 72, 74, 73) },
  selin: { targets: T(70, 71, 72, 72) },
  kerem: { targets: T(71, 72, 70, 71) },
  ece: { targets: T(69, 70, 71, 70) },
  pinar: { targets: T(null, null, null, 74), plan: 'one' },
  deniz: { targets: T(75, 77, 78, 80) },
  irem: { targets: T(68, 70, 72, 74) },
  onur: { targets: T(72, 73, 74, 75) },
  derya: { targets: T(79, 80, 82, 81) },
}

/* ------------------------------------- Ekipler ---------------------------------- */

const PLATFORM: PersonKey[] = ['mert', 'ayse', 'elif', 'burak', 'zeynep', 'kaan', 'seda', 'baris', 'gizem', 'hakan', 'tolga', 'sena']
const SALES: PersonKey[] = ['can', 'selin', 'kerem', 'ece', 'pinar']
const PRODUCT: PersonKey[] = ['deniz', 'irem']

const ROLE_IN_TEAM: Partial<Record<PersonKey, string>> = {
  mert: 'Takım lideri', ayse: 'Backend', elif: 'Frontend', burak: 'Backend', zeynep: 'QA',
  kaan: 'Backend', seda: 'Frontend', baris: 'DevOps', gizem: 'Frontend', hakan: 'Backend',
  tolga: 'Backend', sena: 'Stajyer', oguz: 'Frontend',
  can: 'Ekip yöneticisi', selin: 'Kurumsal', kerem: 'Kurumsal', ece: 'Satış destek', pinar: 'KOBİ',
  deniz: 'Ürün', irem: 'Tasarım',
}

export const TEAM_ID = {
  platform: uid('team', 'platform'),
  sales: uid('team', 'kurumsal-satis'),
  product: uid('team', 'urun-tasarim'),
  mobile: uid('team', 'mobil'),
  data: uid('team', 'veri-platformu'),
}

function buildTeams(): { teams: TeamRow[]; members: MemberRow[] } {
  const teams: TeamRow[] = [
    { id: TEAM_ID.platform, name: 'Platform Ekibi', description: 'Ödeme, kimlik ve çekirdek servisler.', departmentId: DEPT.yazilim, leadEmployeeId: EMP.mert, isActive: true },
    { id: TEAM_ID.mobile, name: 'Mobil Ekip', description: 'iOS ve Android uygulamaları — kuruluş aşamasında.', departmentId: DEPT.mobil, leadEmployeeId: null, isActive: true },
    { id: TEAM_ID.data, name: 'Veri Platformu', description: 'Platform ekibine katıldı; pasif.', departmentId: DEPT.yazilim, leadEmployeeId: null, isActive: false },
    { id: TEAM_ID.sales, name: 'Kurumsal Satış', description: 'Kurumsal müşteri kazanımı ve yenileme.', departmentId: DEPT.satis, leadEmployeeId: EMP.can, isActive: true },
    { id: TEAM_ID.product, name: 'Ürün Tasarım', description: null, departmentId: DEPT.urun, leadEmployeeId: null, isActive: true },
  ]

  const joined = (k: PersonKey) => {
    const hired = hireDateOf(EMP[k]) ?? '2024-01-01'
    return hired > '2024-01-15' ? hired : '2024-01-15'
  }
  const member = (teamId: string, k: PersonKey, leftOn: string | null = null): MemberRow => ({
    id: uid('member', `${teamId}:${k}`),
    teamId,
    employeeId: EMP[k],
    roleInTeam: ROLE_IN_TEAM[k] ?? null,
    joinedOn: joined(k),
    leftOn,
  })

  const members = [
    ...PLATFORM.map((k) => member(TEAM_ID.platform, k)),
    member(TEAM_ID.platform, 'oguz', '2026-05-31'),
    ...SALES.map((k) => member(TEAM_ID.sales, k)),
    ...PRODUCT.map((k) => member(TEAM_ID.product, k)),
  ]
  return { teams, members }
}

/* ------------------------------------ Hedefler ---------------------------------- */

interface GoalSeed {
  title: string
  weight: number
  target: number | null
  unit: string | null
  description?: string
}

const GOAL_POOL: Record<Exclude<keyof typeof DEPT, 'mobil'>, GoalSeed[]> = {
  yazilim: [
    { title: 'Ödeme servisi v2 lansmanı', weight: 60, target: null, unit: null, description: 'Yeni ödeme akışının üretime alınması.' },
    { title: 'Test kapsamını artır', weight: 40, target: 80, unit: '%' },
    { title: 'Kritik hata kapatma', weight: 30, target: 25, unit: 'adet' },
  ],
  satis: [
    { title: 'Çeyreklik satış kotası', weight: 60, target: 1_500_000, unit: '₺' },
    { title: 'Yeni kurumsal müşteri', weight: 40, target: 8, unit: 'müşteri' },
  ],
  urun: [
    { title: 'Kullanıcı araştırması', weight: 50, target: 12, unit: 'görüşme' },
    { title: 'Tasarım sistemi v3', weight: 50, target: null, unit: null },
  ],
  ik: [
    { title: 'Eğitim tamamlama oranı', weight: 50, target: 95, unit: '%' },
    { title: 'Yetenek havuzu yenileme', weight: 50, target: null, unit: null },
  ],
}

/* ----------------------------------- Üretim ------------------------------------ */

const DEPT_OF: Record<PersonKey, Exclude<keyof typeof DEPT, 'mobil'>> = {
  mert: 'yazilim', ayse: 'yazilim', elif: 'yazilim', burak: 'yazilim', zeynep: 'yazilim', kaan: 'yazilim',
  seda: 'yazilim', baris: 'yazilim', gizem: 'yazilim', hakan: 'yazilim', tolga: 'yazilim', sena: 'yazilim',
  oguz: 'yazilim', emre: 'yazilim',
  can: 'satis', selin: 'satis', kerem: 'satis', ece: 'satis', pinar: 'satis',
  deniz: 'urun', irem: 'urun', onur: 'ik', derya: 'ik',
}

/** Kimin kimi, hangi türle değerlendirdiği. */
function reviewersOf(k: PersonKey): { reviewer: PersonKey; type: ReviewType }[] {
  if (k === 'mert') return [{ reviewer: 'emre', type: 'Manager' }, { reviewer: 'ayse', type: 'Peer' }, { reviewer: 'elif', type: 'Upward' }, { reviewer: 'mert', type: 'Self' }]
  if (k === 'emre') return [{ reviewer: 'mert', type: 'Upward' }, { reviewer: 'deniz', type: 'Peer' }, { reviewer: 'emre', type: 'Self' }]
  if (k === 'can') return [{ reviewer: 'selin', type: 'Upward' }, { reviewer: 'deniz', type: 'Peer' }, { reviewer: 'can', type: 'Self' }]
  if (k === 'deniz') return [{ reviewer: 'emre', type: 'Manager' }, { reviewer: 'irem', type: 'Upward' }, { reviewer: 'deniz', type: 'Self' }]
  if (k === 'irem') return [{ reviewer: 'deniz', type: 'Manager' }, { reviewer: 'irem', type: 'Self' }]
  if (k === 'onur') return [{ reviewer: 'derya', type: 'Manager' }, { reviewer: 'onur', type: 'Self' }]
  if (k === 'derya') return [{ reviewer: 'onur', type: 'Peer' }, { reviewer: 'derya', type: 'Self' }]
  if (SALES.includes(k)) {
    const peer: PersonKey = k === 'selin' ? 'kerem' : 'selin'
    return [{ reviewer: 'can', type: 'Manager' }, { reviewer: peer, type: 'Peer' }, { reviewer: k, type: 'Self' }]
  }
  // Platform üyeleri (ve eski üye)
  const i = Math.max(0, PLATFORM.indexOf(k))
  const peers = (['ayse', 'baris', 'seda', 'elif'] as PersonKey[]).filter((p) => p !== k)
  const peer = peers[i % peers.length]
  const list: { reviewer: PersonKey; type: ReviewType }[] = [
    { reviewer: 'mert', type: 'TeamLead' },
    { reviewer: peer, type: 'Peer' },
    { reviewer: k, type: 'Self' },
  ]
  if (k === 'ayse' || k === 'kaan' || k === 'burak') list.unshift({ reviewer: 'emre', type: 'Manager' })
  return list
}

const STRENGTHS = [
  'Karmaşık konuları sade anlatıyor; ekipte güven veren bir duruşu var.',
  'Teknik kararlarında gerekçeli ve belgeleyen biri.',
  'Sorumluluk aldığı işi sonuna kadar götürüyor.',
  'Müşteriyle ilişkisi güçlü, beklentileri iyi yönetiyor.',
]
const IMPROVEMENTS = [
  'Tahminlerini parçalara bölerek vermesi öngörülebilirliği artırır.',
  'Kod incelemelerine daha erken dahil olabilir.',
  'Önceliklendirmede ekip liderine daha sık danışabilir.',
]

function iso(date: string, hour = 10) {
  return `${date}T${String(hour).padStart(2, '0')}:00:00Z`
}

export function buildSeed(scenario: Scenario): Omit<Db, 'schema' | 'scenario'> {
  const metrics = scenario === 'bos' ? [] : buildMetrics()
  const configs = buildConfigs()
  const { teams, members } = buildTeams()
  const allMetrics = buildMetrics()

  const cycles: CycleRow[] = CYCLES.map((c) => ({
    id: CYCLE_ID[c.key],
    name: c.name,
    year: c.year,
    period: c.period,
    status: c.status,
    startDate: c.start,
    endDate: c.end,
    configVersion: c.configVersion,
    finalizedEmployeeCount: null,
    closedAt: c.status === 'Closed' ? iso(c.end, 17) : null,
  }))

  const goals: GoalRow[] = []
  const reviews: ReviewRow[] = []

  for (const [key, profile] of Object.entries(PROFILES) as [PersonKey, Profile][]) {
    const empId = EMP[key]
    const dept = DEPT_OF[key]

    for (const c of CYCLES) {
      if (c.status === 'Planned') continue
      const target = profile.targets[c.key]
      const hired = hireDateOf(empId) ?? '2000-01-01'
      const employed = hired <= c.end && !(key === 'oguz' && c.start > '2026-05-31')
      if (!employed) continue

      const r = rng(`${key}:${c.key}`)
      const isActive = c.status === 'Open'

      /* ---- hedefler ---- */
      const skipGoals = isActive && profile.noGoals
      if (!skipGoals && (target !== undefined || isActive)) {
        const pool = GOAL_POOL[dept]
        const count = key === 'ayse' || key === 'derya' ? pool.length : Math.min(2, pool.length)
        for (let gi = 0; gi < count; gi++) {
          const g = pool[gi]
          const t = target ?? 0
          let status: GoalStatus
          let current: number | null = null
          if (g.target !== null) {
            const ratio = target === undefined ? 0.1 + r() * 0.2 : clamp(t / 100 + (r() - 0.45) * 0.18, 0.05, 1.3)
            current = g.unit === '₺' ? Math.round((g.target * ratio) / 1000) * 1000 : Math.round(g.target * ratio)
            // Ayşe hedefi aşıyor: çubuk 100'de durur, fazlası puana yansımaz.
            if (key === 'ayse' && isActive && g.title === 'Kritik hata kapatma') current = 31
            status = isActive ? (target === undefined ? 'Draft' : 'Active') : current >= g.target ? 'Achieved' : t >= 60 ? 'Achieved' : 'Missed'
          } else {
            status = isActive
              ? target === undefined ? 'Draft' : t >= 85 ? 'Achieved' : 'Active'
              : t >= 70 ? 'Achieved' : 'Missed'
          }
          goals.push({
            id: uid('goal', `${key}:${c.key}:${gi}`),
            cycleId: CYCLE_ID[c.key],
            employeeId: empId,
            title: g.title,
            description: g.description ?? null,
            weight: g.weight,
            targetValue: g.target,
            currentValue: current,
            unit: g.unit,
            status,
          })
        }
      }

      /* ---- değerlendirmeler ---- */
      if (target === undefined) continue
      const plan: Plan = isActive ? (profile.plan ?? 'full') : 'full'
      if (plan === 'none') continue

      let reviewers = reviewersOf(key)
      if (plan === 'one') reviewers = reviewers.filter((x) => x.type !== 'Self' && x.type !== 'Peer').slice(0, 1)
      if (plan === 'self') reviewers = reviewers.filter((x) => x.type === 'Self')

      const applicable = allMetrics.filter((m) => {
        if (m.departmentId && m.departmentId !== DEPT[dept]) return false
        // Arşivlenmiş metrik yalnızca 2025'teki değerlendirmelerde kullanılmış.
        if (!m.isActive) return c.key === '2025-h2'
        return true
      })

      reviewers.forEach(({ reviewer, type }, ri) => {
        const bias = type === 'Self' ? 6 : (r() - 0.5) * 8
        // Elif'in açık dönemdeki öz değerlendirmesi taslakta — "devam et" akışı için.
        const isDraft = isActive && key === 'elif' && type === 'Self'
        const submittedDay = isActive ? `2026-09-0${1 + ((ri + key.length) % 8)}` : c.end
        reviews.push({
          id: uid('review', `${key}:${c.key}:${reviewer}:${type}`),
          cycleId: CYCLE_ID[c.key],
          employeeId: empId,
          reviewerEmployeeId: EMP[reviewer],
          type,
          submittedAt: isDraft ? null : iso(submittedDay, 9 + ri),
          strengths: isDraft ? null : STRENGTHS[(ri + key.length) % STRENGTHS.length],
          improvements: isDraft ? null : IMPROVEMENTS[(ri + key.length) % IMPROVEMENTS.length],
          comments: null,
          scores: isDraft
            ? applicable.slice(0, 3).map((m) => ({ metricId: m.id, value: m.scale === 'Percentage' ? 70 : m.range.max - 1 }))
            : applicable.map((m) => {
                const n = clamp(target + bias + (r() - 0.5) * 14, 0, 100)
                const raw = m.range.min + (n / 100) * (m.range.max - m.range.min)
                const floor = Math.floor(raw)
                const value = clamp(floor + (r() < raw - floor ? 1 : 0), m.range.min, m.range.max)
                return { metricId: m.id, value }
              }),
          createdAt: iso(isActive ? '2026-08-25' : c.start, 8),
        })
      })
    }
  }

  /* ---- açık dönemde bekleyen taslaklar ---- */
  const q3 = CYCLE_ID['2026-q3']
  const platformMetrics = allMetrics.filter((m) => m.isActive && (!m.departmentId || m.departmentId === DEPT.yazilim))
  reviews.push(
    {
      id: uid('review', 'draft:tolga'),
      cycleId: q3,
      employeeId: EMP.tolga,
      reviewerEmployeeId: EMP.mert,
      type: 'TeamLead',
      submittedAt: null,
      strengths: 'İlk iki ayında ödeme servisine hızlı adapte oldu.',
      improvements: null,
      comments: null,
      // Yarım kalmış taslak: form geri yüklenince bu değerler dolu gelir.
      scores: platformMetrics.slice(0, 4).map((m, i) => ({
        metricId: m.id,
        value: m.scale === 'Percentage' ? 62 : m.scale === 'OneToTen' ? 7 : 3 + (i % 2),
      })),
      createdAt: iso('2026-09-06', 11),
    },
    {
      id: uid('review', 'draft:sena'),
      cycleId: q3,
      employeeId: EMP.sena,
      reviewerEmployeeId: EMP.mert,
      type: 'TeamLead',
      submittedAt: null,
      strengths: null,
      improvements: null,
      comments: null,
      scores: [],
      createdAt: iso('2026-09-09', 15),
    },
    {
      id: uid('review', 'draft:pinar-peer'),
      cycleId: q3,
      employeeId: EMP.pinar,
      reviewerEmployeeId: EMP.selin,
      type: 'Peer',
      submittedAt: null,
      strengths: null,
      improvements: null,
      comments: null,
      scores: [],
      createdAt: iso('2026-09-02', 10),
    },
  )

  // Arşivlenmiş metriğin kullanıldığı değerlendirmeler "tek başına" kalmasın diye aktif metrik listesi
  // `metrics` ile tohumlanır; boş senaryoda değerlendirmeler yine vardır ama metrik yoktur.
  return {
    metrics,
    configs,
    teams,
    members,
    cycles,
    goals,
    reviews: scenario === 'bos' ? [] : reviews,
    feedback: buildFeedback(allMetrics),
  }
}

/* ---------------------------------- Geri bildirim -------------------------------- */

function buildFeedback(metrics: MetricRow[]): FeedbackRow[] {
  const mid = (name: string) => metrics.find((m) => m.name === name)?.id ?? null
  const rows: Omit<FeedbackRow, 'id'>[] = [
    { fromId: EMP.mert, toId: EMP.elif, reason: 'Recognition', reasonDetail: null, sentiment: 'Positive', body: 'Ödeme ekranının yeniden tasarımında gösterdiğin sahiplenme harikaydı; lansman bir hafta erken çıktı.', metricId: mid('Sorumluluk alma'), visibleToEmployee: true, isRead: true, readAt: iso('2026-09-08', 14), createdAt: iso('2026-09-08', 11) },
    { fromId: EMP.ayse, toId: EMP.elif, reason: 'PeerObservation', reasonDetail: null, sentiment: 'Positive', body: 'Kod incelemelerinde verdiğin geri bildirimler çok net ve öğretici. Yeni gelenler için örnek oluyor.', metricId: mid('Kod kalitesi'), visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-10', 16) },
    { fromId: EMP.mert, toId: EMP.elif, reason: 'Improvement', reasonDetail: 'Sprint 34 ve 35\'te tahminler ortalama %40 saptı.', sentiment: 'Constructive', body: 'Tahminlerini daha küçük parçalara bölerek vermeyi deneyelim; bir sonraki birebirde birlikte bakalım.', metricId: mid('Teslimat öngörülebilirliği'), visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-03', 10) },
    { fromId: EMP.emre, toId: EMP.elif, reason: 'Coaching', reasonDetail: null, sentiment: 'Neutral', body: 'Q4 sonunda kıdem değerlendirmesi için hazır olabilir. Teknik liderlik fırsatları açalım; mimari toplantılara dahil edelim.', metricId: null, visibleToEmployee: false, isRead: false, readAt: null, createdAt: iso('2026-08-28', 9) },
    { fromId: EMP.zeynep, toId: EMP.elif, reason: 'PeerObservation', reasonDetail: null, sentiment: 'Positive', body: 'Test senaryolarını erkenden paylaşman regresyon planını çok kolaylaştırdı.', metricId: mid('İş birliği'), visibleToEmployee: true, isRead: true, readAt: iso('2026-08-20', 12), createdAt: iso('2026-08-19', 17) },
    { fromId: EMP.mert, toId: EMP.burak, reason: 'Incident', reasonDetail: 'Üretim ortamına incelemesiz iki değişiklik gönderildi (14 ve 21 Ağustos).', sentiment: 'Constructive', body: 'Değişiklik yönetimi sürecine uyum konusunda net bir plan yapmamız gerekiyor. Bu hafta birlikte üzerinden geçelim.', metricId: mid('Kod kalitesi'), visibleToEmployee: true, isRead: true, readAt: iso('2026-08-23', 9), createdAt: iso('2026-08-22', 18) },
    { fromId: EMP.mert, toId: EMP.burak, reason: 'Coaching', reasonDetail: null, sentiment: 'Neutral', body: 'Haftalık birebirlerle başlıyoruz; ilk hedef inceleme sürecini oturtmak.', metricId: null, visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-01', 10) },
    { fromId: EMP.emre, toId: EMP.burak, reason: 'Other', reasonDetail: null, sentiment: 'Neutral', body: 'İK ile birlikte gelişim planı hazırlanacak; performans görüşmesi Eylül sonunda.', metricId: null, visibleToEmployee: false, isRead: false, readAt: null, createdAt: iso('2026-09-04', 16) },
    { fromId: EMP.emre, toId: EMP.ayse, reason: 'Recognition', reasonDetail: null, sentiment: 'Positive', body: 'Ödeme servisi v2 mimarisi ekibin çıtasını yükseltti. Tasarım dokümanın şirket genelinde örnek gösterildi.', metricId: mid('Teknik derinlik'), visibleToEmployee: true, isRead: true, readAt: iso('2026-08-15', 10), createdAt: iso('2026-08-14', 15) },
    { fromId: EMP.mert, toId: EMP.ayse, reason: 'GoalProgress', reasonDetail: null, sentiment: 'Positive', body: 'Kritik hata hedefini çeyrek bitmeden aştın — 25 hedefe karşı 31.', metricId: null, visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-09', 11) },
    { fromId: EMP.elif, toId: EMP.mert, reason: 'Recognition', reasonDetail: null, sentiment: 'Positive', body: 'Sprint planlamalarındaki şeffaflığın için teşekkürler; öncelikler hiç bu kadar net olmamıştı.', metricId: null, visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-05', 13) },
    { fromId: EMP.ayse, toId: EMP.mert, reason: 'PeerObservation', reasonDetail: null, sentiment: 'Neutral', body: 'Mimari kararlarda ekibe daha fazla söz hakkı tanıyabiliriz; RFC sürecini deneyelim mi?', metricId: mid('Mentorluk'), visibleToEmployee: true, isRead: true, readAt: iso('2026-08-30', 9), createdAt: iso('2026-08-29', 17) },
    { fromId: EMP.mert, toId: EMP.kaan, reason: 'Improvement', reasonDetail: 'Son iki sprintte teslim tarihleri üç kez kaydı.', sentiment: 'Constructive', body: 'Yükünü birlikte gözden geçirelim; destek gereken yerleri netleştirelim.', metricId: mid('Zamanında teslim'), visibleToEmployee: true, isRead: true, readAt: iso('2026-09-07', 10), createdAt: iso('2026-09-06', 18) },
    { fromId: EMP.mert, toId: EMP.zeynep, reason: 'Improvement', reasonDetail: 'Regresyon testleri iki sürümde eksik kaldı.', sentiment: 'Constructive', body: 'Sürüm öncesi kontrol listesini birlikte güncelleyelim.', metricId: mid('Test kapsamı'), visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-08-27', 11) },
    { fromId: EMP.mert, toId: EMP.hakan, reason: 'Other', reasonDetail: null, sentiment: 'Neutral', body: 'Öz değerlendirmeni aldım, teşekkürler. Takım lideri değerlendirmesi bu hafta tamamlanacak.', metricId: null, visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-10', 9) },
    { fromId: EMP.can, toId: EMP.selin, reason: 'Recognition', reasonDetail: null, sentiment: 'Positive', body: 'Çeyreğin en büyük kurumsal anlaşması senin eserin. Tebrikler!', metricId: mid('Hedef gerçekleşme oranı'), visibleToEmployee: true, isRead: true, readAt: iso('2026-08-12', 10), createdAt: iso('2026-08-11', 16) },
    { fromId: EMP.can, toId: EMP.kerem, reason: 'GoalProgress', reasonDetail: null, sentiment: 'Neutral', body: 'Kotanın %70\'indesin; son ay için fırsat hattını birlikte gözden geçirelim.', metricId: mid('Hedef gerçekleşme oranı'), visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-02', 14) },
    { fromId: EMP.deniz, toId: EMP.irem, reason: 'ReviewSummary', reasonDetail: null, sentiment: 'Positive', body: 'Q2 özeti: araştırma derinliği çok güçlü; sunumları biraz daha kısa tutabiliriz.', metricId: null, visibleToEmployee: true, isRead: true, readAt: iso('2026-07-06', 10), createdAt: iso('2026-07-03', 15) },
    { fromId: EMP.onur, toId: EMP.derya, reason: 'Recognition', reasonDetail: null, sentiment: 'Positive', body: 'Yeni işe alım sürecini kurarken bize alan tanıdığın için teşekkürler.', metricId: null, visibleToEmployee: true, isRead: false, readAt: null, createdAt: iso('2026-09-07', 12) },
    { fromId: EMP.derya, toId: EMP.onur, reason: 'Coaching', reasonDetail: null, sentiment: 'Neutral', body: 'Ücret bantları projesini Q4\'te sen yönetebilirsin; hazırlık için bir plan çıkaralım.', metricId: null, visibleToEmployee: true, isRead: true, readAt: iso('2026-08-18', 10), createdAt: iso('2026-08-17', 11) },
  ]
  return rows.map((row, i) => ({ ...row, id: uid('feedback', String(i)) }))
}
