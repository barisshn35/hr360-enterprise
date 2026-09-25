/**
 * Mock veritabanı — bellekte tutulur, sekme ömrü boyunca sessionStorage'a
 * yazılır. Böylece sayfa yenilense de oluşturduğunuz metrik, gönderdiğiniz
 * değerlendirme kaybolmaz. `?sifirla=1` ya da senaryo değişimi tohumu yeniden
 * kurar.
 *
 * Satırlar backend'in TEL şeklinde tutulur (ör. metrikte `range`, puanlama
 * ayarında düz alanlar). Hesaplanan yanıtlar (`/reviews/score`, analizler,
 * öneriler) `engine/` altındaki kurallarla bu satırlardan üretilir — yani
 * ayarı değiştirdiğinizde puanlar ve öneriler gerçekten değişir.
 */

import type {
  CyclePeriod,
  CycleStatus,
  FeedbackReason,
  FeedbackSentiment,
  GoalStatus,
  MetricCategory,
  MetricScale,
  ReviewType,
  ScoringConfigInput,
} from '@/api/performance/types'
import { readScenario, type Scenario } from './scenario'
import { buildSeed } from './seed'

export interface MetricRow {
  id: string
  code: string
  name: string
  description: string | null
  category: MetricCategory
  scale: MetricScale
  weight: number
  departmentId: string | null
  isRequired: boolean
  isActive: boolean
  sortOrder: number
  range: { min: number; max: number }
}

export interface ConfigRow extends ScoringConfigInput {
  id: string
  version: number
  createdAt: string
  createdBy: string
}

export interface TeamRow {
  id: string
  name: string
  description: string | null
  departmentId: string
  leadEmployeeId: string | null
  isActive: boolean
}

export interface MemberRow {
  id: string
  teamId: string
  employeeId: string
  roleInTeam: string | null
  joinedOn: string
  leftOn: string | null
}

export interface CycleRow {
  id: string
  name: string
  year: number
  period: CyclePeriod
  status: CycleStatus
  startDate: string
  endDate: string
  /** Kapanışta sabitlenen ayar sürümü. */
  configVersion: number | null
  finalizedEmployeeCount: number | null
  closedAt: string | null
}

export interface GoalRow {
  id: string
  cycleId: string
  employeeId: string
  title: string
  description: string | null
  weight: number
  targetValue: number | null
  currentValue: number | null
  unit: string | null
  status: GoalStatus
}

export interface ReviewRow {
  id: string
  cycleId: string
  employeeId: string
  reviewerEmployeeId: string
  type: ReviewType
  submittedAt: string | null
  strengths: string | null
  improvements: string | null
  comments: string | null
  scores: { metricId: string; value: number; comment?: string }[]
  createdAt: string
}

export interface FeedbackRow {
  id: string
  fromId: string
  toId: string
  reason: FeedbackReason
  reasonDetail: string | null
  sentiment: FeedbackSentiment
  body: string
  metricId: string | null
  visibleToEmployee: boolean
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export interface Db {
  schema: number
  scenario: Scenario
  metrics: MetricRow[]
  configs: ConfigRow[]
  teams: TeamRow[]
  members: MemberRow[]
  cycles: CycleRow[]
  goals: GoalRow[]
  reviews: ReviewRow[]
  feedback: FeedbackRow[]
}

const KEY = 'hr360.mock.db'
/** Tohum şekli değişince eski kayıt otomatik atılır. */
const SCHEMA = 3

let db: Db | null = null

function load(): Db | null {
  try {
    const raw = window.sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Db
    return parsed.schema === SCHEMA ? parsed : null
  } catch {
    return null
  }
}

export function getDb(): Db {
  const scenario = readScenario()
  if (db && db.scenario === scenario) return db

  const stored = load()
  const reset = new URLSearchParams(window.location.search).get('sifirla') === '1'
  if (stored && stored.scenario === scenario && !reset) {
    db = stored
  } else {
    db = { schema: SCHEMA, scenario, ...buildSeed(scenario) }
    save()
  }
  return db
}

export function save() {
  if (!db) return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* depolama dolu/kapalı — bellekte devam */
  }
}

export function resetDb() {
  db = null
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* yok say */
  }
}
