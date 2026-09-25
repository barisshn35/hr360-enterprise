/**
 * Performans servisi uçları — `/api/performance/*`.
 *
 * Backend'in iş kuralları burada da uygulanır; ekranların hata yollarını
 * görebilmesi için mesajlar backend'deki gibi `{ message }` ile döner:
 *
 *   - kullanılmış metriğin ölçeği değişmez                  → 400
 *   - hedef + metrik payı ≠ 100, eşikler artan değil          → 400
 *   - zorunlu metrik eksik gönderim                           → 400 + missing[]
 *   - gönderilmiş değerlendirme yeniden gönderilemez          → 400
 *   - kapanmış döneme değerlendirme gönderilemez              → 400
 *   - taslak (PUT …/draft): zorunluluk yok, aralık kontrolü var → 400
 *   - çalışan başkasının hedeflerini (ya da tümünü) okuyamaz  → 403
 *   - kapanan dönem yeniden açılamaz                          → 400
 *   - yapıcı eleştiri gerekçesiz yazılamaz                    → 400
 *   - /me uçları: e-posta çalışan kaydıyla eşleşmezse         → 404
 */

import { http } from 'msw'
import { CATEGORIES, categoryWeightKey, scaleRange } from '@/api/performance/labels'
import type {
  CyclePeriod,
  CycleStatus,
  FeedbackReason,
  FeedbackSentiment,
  GoalStatus,
  MetricCategory,
  MetricScale,
  ReviewType,
} from '@/api/performance/types'
import { getDb, save, type ConfigRow, type FeedbackRow, type MetricRow, type ReviewRow } from '../db'
import { departmentOf, employeeByEmail, nameOf, person } from '../data/people'
import { employeeAnalytics, employeeCycleHistory, cycleCompare, cycleResult, teamAnalytics, vsTeam, activeMemberIds } from '../engine/analytics'
import { ML_MIN_EMPLOYEES, recommend, recommendAll } from '../engine/recommend'
import { computeScore, currentConfig, currentCycle, participantsOf, submittedReviews } from '../engine/score'
import { readScenario } from '../scenario'
import { mockUser, readMockRole } from '../session'
import { bad, forbidden, latency, newId, noContent, notFound, nowIso, ok, readJson, serverError, slugify } from '../util'

const P = '/api/performance'

/* ----------------------------------- yardımcılar -------------------------------- */

const isManager = () => readMockRole() !== 'employee'

function me() {
  return employeeByEmail(mockUser().email)
}

const NO_RECORD = 'Hesabınıza bağlı çalışan kaydı bulunamadı.'

function failIfScenario() {
  return readScenario() === 'hata' ? serverError('Performans servisi şu an yanıt vermiyor. Lütfen biraz sonra tekrar deneyin.') : null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

function reviewWire(r: ReviewRow) {
  return {
    id: r.id,
    cycleId: r.cycleId,
    employeeId: r.employeeId,
    reviewerEmployeeId: r.reviewerEmployeeId,
    type: r.type,
    status: r.submittedAt ? 'Submitted' : 'Draft',
    submittedAt: r.submittedAt,
    strengths: r.strengths,
    improvements: r.improvements,
    comments: r.comments,
    scores: r.scores,
    createdAt: r.createdAt,
  }
}

/** Backend'in kapanmış döneme gönderimde döndürdüğü mesaj (birebir). */
const CYCLE_CLOSED = 'Bu dönem kapatılmış, yeni değerlendirme gönderilemez.'

type ScoreIn = ReviewRow['scores'][number]

/**
 * Taslak ve gönderimin ortak kontrolü: metrik bu kişiye uygulanıyor mu,
 * değer ölçek aralığında mı. Uygulanan metrikler, değerlendirilen kişinin
 * departmanına ait olanlar ile departmansız (şirket geneli) olanlardır.
 */
function checkScores(
  db: ReturnType<typeof getDb>,
  r: ReviewRow,
  b: Record<string, unknown>,
): { scores: ScoreIn[]; applicable: MetricRow[] } | { error: ReturnType<typeof bad> } {
  const raw = Array.isArray(b.scores) ? (b.scores as Record<string, unknown>[]) : []
  const dept = departmentOf(r.employeeId)
  const applicable = db.metrics.filter((m) => m.isActive && (!m.departmentId || m.departmentId === dept))
  const scores: ScoreIn[] = []
  for (const s of raw) {
    const m = applicable.find((x) => x.id === str(s.metricId))
    const v = num(s.value)
    if (!m) return { error: bad('Bu çalışana uygulanmayan bir metrik gönderildi.') }
    if (v === null || v < m.range.min || v > m.range.max) {
      return { error: bad(`"${m.name}" için değer ${m.range.min}–${m.range.max} aralığında olmalıdır.`) }
    }
    scores.push({ metricId: m.id, value: v, ...(str(s.comment) ? { comment: str(s.comment) } : {}) })
  }
  return { scores, applicable }
}

function writeReview(r: ReviewRow, b: Record<string, unknown>, scores: ScoreIn[]) {
  r.scores = scores
  r.strengths = str(b.strengths) || null
  r.improvements = str(b.improvements) || null
  r.comments = str(b.comments) || null
}

function feedbackWire(f: FeedbackRow) {
  const db = getDb()
  const metric = f.metricId ? db.metrics.find((m) => m.id === f.metricId) : null
  return {
    id: f.id,
    from: person(f.fromId),
    to: person(f.toId),
    reason: f.reason,
    reasonDetail: f.reasonDetail,
    sentiment: f.sentiment,
    body: f.body,
    metricId: f.metricId,
    metricName: metric?.name ?? null,
    visibleToEmployee: f.visibleToEmployee,
    isRead: f.isRead,
    readAt: f.readAt,
    createdAt: f.createdAt,
  }
}

const CATEGORY_ORDER: Record<MetricCategory, number> = { Technical: 0, Behavioral: 1, Leadership: 2, Delivery: 3, Custom: 4 }
const sortMetrics = (a: MetricRow, b: MetricRow) =>
  CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.sortOrder - b.sortOrder

const SCALES: MetricScale[] = ['OneToFive', 'OneToTen', 'Percentage']
const REVIEW_TYPES: ReviewType[] = ['Self', 'Manager', 'TeamLead', 'Peer', 'Upward']
const REASONS: FeedbackReason[] = ['Recognition', 'GoalProgress', 'Improvement', 'Coaching', 'Incident', 'PeerObservation', 'ReviewSummary', 'Other']
const SENTIMENTS: FeedbackSentiment[] = ['Positive', 'Neutral', 'Constructive']
const PERIODS = ['week', 'month', 'quarter', 'halfYear', 'year', 'all'] as const
type Period = (typeof PERIODS)[number]
const periodOf = (url: URL): Period => {
  const p = url.searchParams.get('period')
  return (PERIODS as readonly string[]).includes(p ?? '') ? (p as Period) : 'quarter'
}

/** Metrik girdisini doğrular; hata varsa mesaj döner. */
function validateMetric(body: Record<string, unknown>): string | null {
  if (!str(body.name)) return 'Metrik adı zorunludur.'
  if (str(body.name).length > 80) return 'Metrik adı en fazla 80 karakter olabilir.'
  if (!(CATEGORIES as string[]).includes(str(body.category))) return 'Geçerli bir kategori seçin.'
  if (!(SCALES as string[]).includes(str(body.scale))) return 'Geçerli bir ölçek seçin.'
  const w = num(body.weight)
  if (w === null || w <= 0) return 'Ağırlık sıfırdan büyük olmalıdır.'
  if (w > 100) return 'Ağırlık en fazla 100 olabilir.'
  return null
}

/* ------------------------------------- uçlar ------------------------------------ */

export const performanceHandlers = [
  /* ---------------------------------- metrikler --------------------------------- */

  http.get(`${P}/metrics`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const dept = url.searchParams.get('departmentId')
    const category = url.searchParams.get('category')
    const includeArchived = url.searchParams.get('includeArchived') === 'true'
    const list = getDb()
      .metrics.filter((m) => includeArchived || m.isActive)
      .filter((m) => !dept || m.departmentId === dept || m.departmentId === null)
      .filter((m) => !category || m.category === category)
      .sort(sortMetrics)
    return ok(list)
  }),

  http.post(`${P}/metrics/apply-template`, async ({ request }) => {
    await latency()
    if (!isManager()) return forbidden()
    const template = new URL(request.url).searchParams.get('template')
    const sets: Record<string, [string, MetricCategory, MetricScale, number, boolean][]> = {
      genel: [
        ['İş kalitesi', 'Technical', 'OneToFive', 2, true],
        ['Zamanında teslim', 'Delivery', 'OneToTen', 2, true],
        ['İletişim', 'Behavioral', 'OneToFive', 1, true],
        ['İş birliği', 'Behavioral', 'OneToFive', 1, false],
        ['Sorumluluk alma', 'Leadership', 'OneToFive', 1, false],
      ],
      yazilim: [
        ['Kod kalitesi', 'Technical', 'OneToFive', 2.5, true],
        ['Teknik derinlik', 'Technical', 'OneToFive', 2, false],
        ['Test kapsamı', 'Technical', 'Percentage', 1.5, false],
        ['Teslimat öngörülebilirliği', 'Delivery', 'OneToFive', 2, true],
        ['Kod inceleme katkısı', 'Behavioral', 'OneToFive', 1, false],
      ],
      satis: [
        ['Hedef gerçekleşme oranı', 'Delivery', 'Percentage', 3, true],
        ['Müşteri memnuniyeti', 'Behavioral', 'OneToTen', 2, true],
        ['Fırsat dönüşümü', 'Delivery', 'Percentage', 2, false],
        ['CRM disiplini', 'Behavioral', 'OneToFive', 1, false],
        ['Ekip katkısı', 'Leadership', 'OneToFive', 1, false],
      ],
    }
    const set = template ? sets[template] : undefined
    if (!set) return bad('Geçersiz şablon. Kullanılabilir şablonlar: genel, yazilim, satis.')
    const db = getDb()
    const created: MetricRow[] = []
    for (const [name, category, scale, weight, isRequired] of set) {
      const code = slugify(name)
      if (db.metrics.some((m) => m.code === code && m.isActive)) continue
      const inCat = db.metrics.filter((m) => m.category === category)
      const row: MetricRow = {
        id: newId(),
        code,
        name,
        description: null,
        category,
        scale,
        weight,
        departmentId: null,
        isRequired,
        isActive: true,
        sortOrder: CATEGORY_ORDER[category] * 10 + inCat.length + 1,
        range: { ...scaleRange[scale] },
      }
      db.metrics.push(row)
      created.push(row)
    }
    save()
    return ok(created, 201)
  }),

  http.post(`${P}/metrics`, async ({ request }) => {
    await latency()
    if (!isManager()) return forbidden()
    const body = await readJson(request)
    const err = validateMetric(body)
    if (err) return bad(err)
    const db = getDb()
    const code = slugify(str(body.name))
    if (db.metrics.some((m) => m.code === code && m.isActive)) return bad(`"${str(body.name)}" adında etkin bir metrik zaten var.`)
    const category = str(body.category) as MetricCategory
    const scale = str(body.scale) as MetricScale
    const row: MetricRow = {
      id: newId(),
      code: db.metrics.some((m) => m.code === code) ? `${code}-${db.metrics.length + 1}` : code,
      name: str(body.name),
      description: str(body.description) || null,
      category,
      scale,
      weight: num(body.weight) as number,
      departmentId: str(body.departmentId) || null,
      isRequired: body.isRequired === true,
      isActive: true,
      sortOrder: num(body.sortOrder) ?? CATEGORY_ORDER[category] * 10 + db.metrics.filter((m) => m.category === category).length + 1,
      range: { ...scaleRange[scale] },
    }
    db.metrics.push(row)
    save()
    return ok(row, 201)
  }),

  http.put(`${P}/metrics/:id`, async ({ request, params }) => {
    await latency()
    if (!isManager()) return forbidden()
    const db = getDb()
    const row = db.metrics.find((m) => m.id === params.id)
    if (!row) return notFound('Metrik bulunamadı.')
    if (!row.isActive) return bad('Arşivlenmiş metrik düzenlenemez.')
    const body = await readJson(request)
    const err = validateMetric(body)
    if (err) return bad(err)
    const scale = str(body.scale) as MetricScale
    if (scale !== row.scale) {
      const used = db.reviews.filter((r) => r.scores.some((s) => s.metricId === row.id)).length
      if (used > 0) {
        return bad(`Bu metrik ${used} değerlendirmede kullanıldı; ölçeği değiştirilemez.`)
      }
    }
    Object.assign(row, {
      name: str(body.name),
      description: str(body.description) || null,
      category: str(body.category) as MetricCategory,
      scale,
      weight: num(body.weight) as number,
      departmentId: str(body.departmentId) || null,
      isRequired: body.isRequired === true,
      sortOrder: num(body.sortOrder) ?? row.sortOrder,
      range: { ...scaleRange[scale] },
    })
    save()
    return ok(row)
  }),

  http.delete(`${P}/metrics/:id`, async ({ params }) => {
    await latency()
    if (!isManager()) return forbidden()
    const row = getDb().metrics.find((m) => m.id === params.id)
    if (!row) return notFound('Metrik bulunamadı.')
    row.isActive = false
    save()
    return noContent()
  }),

  /* ------------------------------- puanlama ayarı ------------------------------- */

  http.get(`${P}/scoring-config`, async () => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    return ok(currentConfig(getDb()))
  }),

  http.get(`${P}/scoring-config/history`, async () => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    return ok([...getDb().configs].reverse())
  }),

  http.put(`${P}/scoring-config`, async ({ request }) => {
    await latency()
    if (!isManager()) return forbidden()
    const b = await readJson(request)
    const fields: (keyof Omit<ConfigRow, 'id' | 'version' | 'createdAt' | 'createdBy' | 'allowSelfOnlyScore'>)[] = [
      'goalWeightPercent', 'metricWeightPercent',
      'technicalWeight', 'behavioralWeight', 'leadershipWeight', 'deliveryWeight', 'customWeight',
      'selfReviewWeight', 'managerReviewWeight', 'teamLeadReviewWeight', 'peerReviewWeight', 'upwardReviewWeight',
      'minReviewsForValidScore',
      'criticalThreshold', 'improvementThreshold', 'recognitionThreshold', 'promotionThreshold',
      'promotionConsecutivePeriods',
    ]
    const missing = fields.filter((f) => num(b[f]) === null)
    if (missing.length || typeof b.allowSelfOnlyScore !== 'boolean') {
      return bad('Puanlama ayarı eksik gönderildi; tüm alanlar zorunludur.', { missing })
    }
    const v = Object.fromEntries(fields.map((f) => [f, num(b[f]) as number])) as Record<(typeof fields)[number], number>
    if (v.goalWeightPercent + v.metricWeightPercent !== 100) return bad('Hedef ve metrik payları toplamı 100 olmalıdır.')
    if (v.goalWeightPercent < 0 || v.metricWeightPercent < 0) return bad('Paylar negatif olamaz.')
    const cats = CATEGORIES.map((c) => v[categoryWeightKey[c] as keyof typeof v])
    if (cats.some((w) => w < 0)) return bad('Kategori ağırlıkları negatif olamaz.')
    if (cats.every((w) => w === 0)) return bad('En az bir kategorinin ağırlığı sıfırdan büyük olmalıdır.')
    if ([v.selfReviewWeight, v.managerReviewWeight, v.teamLeadReviewWeight, v.peerReviewWeight, v.upwardReviewWeight].some((w) => w < 0 || w > 10)) {
      return bad('Değerlendirici katsayıları 0 ile 10 arasında olmalıdır.')
    }
    if (!(v.criticalThreshold < v.improvementThreshold && v.improvementThreshold < v.recognitionThreshold && v.recognitionThreshold < v.promotionThreshold)) {
      return bad('Eşikler artan sırada olmalıdır: kritik < gelişim < takdir < terfi.')
    }
    if (v.criticalThreshold < 0 || v.promotionThreshold > 100) return bad('Eşikler 0–100 aralığında olmalıdır.')
    if (v.minReviewsForValidScore < 1) return bad('Geçerli puan için en az 1 değerlendirme gerekir.')
    if (v.promotionConsecutivePeriods < 1) return bad('Terfi için en az 1 dönem gerekir.')

    const db = getDb()
    const row: ConfigRow = {
      ...v,
      allowSelfOnlyScore: b.allowSelfOnlyScore,
      id: newId(),
      version: currentConfig(db).version + 1,
      createdAt: nowIso(),
      createdBy: mockUser().name,
    }
    db.configs.push(row)
    save()
    return ok(row)
  }),

  /* ------------------------------------ dönemler ---------------------------------- */

  http.get(`${P}/review-cycles`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const year = num(url.searchParams.get('year'))
    const status = url.searchParams.get('status')
    const list = getDb()
      .cycles.filter((c) => (!year || c.year === year) && (!status || c.status === status))
      .sort((a, b) => b.startDate.localeCompare(a.startDate))
    return ok(list)
  }),

  http.get(`${P}/review-cycles/:id/readiness`, async ({ params }) => {
    await latency()
    const db = getDb()
    const cycle = db.cycles.find((c) => c.id === params.id)
    if (!cycle) return notFound('Dönem bulunamadı.')
    const ids = participantsOf(db, cycle)
    const employees = ids.map((id) => {
      const s = computeScore(db, id, cycle.id)
      const pending = db.reviews.filter((r) => r.cycleId === cycle.id && r.employeeId === id && !r.submittedAt).length
      const reason =
        s.score === null
          ? 'Hiç değerlendirme gönderilmedi; kapanışta puansız kalacak.'
          : s.isProvisional
            ? s.provisionalReason
            : null
      return { employeeId: id, name: nameOf(id), isProvisional: reason !== null, reason, reviewCount: s.reviewCount, pendingReviews: pending }
    })
    employees.sort((a, b) => Number(b.isProvisional) - Number(a.isProvisional) || a.name.localeCompare(b.name, 'tr'))
    return ok({
      cycleId: cycle.id,
      readyCount: employees.filter((e) => !e.isProvisional).length,
      provisionalCount: employees.filter((e) => e.isProvisional).length,
      pendingReviewTotal: db.reviews.filter((r) => r.cycleId === cycle.id && !r.submittedAt).length,
      employees,
    })
  }),

  http.get(`${P}/review-cycles/:id`, async ({ params }) => {
    await latency()
    const cycle = getDb().cycles.find((c) => c.id === params.id)
    return cycle ? ok(cycle) : notFound('Dönem bulunamadı.')
  }),

  http.post(`${P}/review-cycles`, async ({ request }) => {
    await latency()
    if (!isManager()) return forbidden()
    const b = await readJson(request)
    const name = str(b.name)
    const year = num(b.year)
    const period = str(b.period) as CyclePeriod
    const startDate = str(b.startDate)
    const endDate = str(b.endDate)
    if (!name) return bad('Dönem adı zorunludur.')
    if (!year || year < 2000 || year > 2100) return bad('Geçerli bir yıl girin.')
    if (!['Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'Annual'].includes(period)) return bad('Geçerli bir dönem türü seçin.')
    if (!startDate || !endDate) return bad('Başlangıç ve bitiş tarihleri zorunludur.')
    if (endDate <= startDate) return bad('Bitiş tarihi başlangıçtan sonra olmalıdır.')
    const db = getDb()
    if (db.cycles.some((c) => c.year === year && c.period === period)) {
      return bad(`${year} yılı için bu dönem türünde bir dönem zaten var.`)
    }
    const row = {
      id: newId(),
      name,
      year,
      period,
      status: 'Planned' as CycleStatus,
      startDate,
      endDate,
      configVersion: null,
      finalizedEmployeeCount: null,
      closedAt: null,
    }
    db.cycles.push(row)
    save()
    return ok(row, 201)
  }),

  http.post(`${P}/review-cycles/:id/status`, async ({ request, params }) => {
    await latency()
    if (!isManager()) return forbidden()
    const db = getDb()
    const cycle = db.cycles.find((c) => c.id === params.id)
    if (!cycle) return notFound('Dönem bulunamadı.')
    const next = str((await readJson(request)).status) as CycleStatus
    if (!['Planned', 'Open', 'InReview', 'Closed'].includes(next)) return bad('Geçerli bir durum seçin.')
    if (cycle.status === 'Closed') return bad('Kapanan dönem yeniden açılamaz.')
    if (next === cycle.status) return bad('Dönem zaten bu durumda.')
    if (cycle.status === 'Open' && next === 'Planned') return bad('Açılmış dönem taslağa geri alınamaz.')
    if (cycle.status === 'Planned' && next === 'Closed') return bad('Taslak dönem doğrudan kapatılamaz; önce açın.')

    cycle.status = next
    if (next === 'Closed') {
      const cfg = currentConfig(db)
      cycle.configVersion = cfg.version
      cycle.closedAt = nowIso()
      // Backend: gönderilmiş en az bir değerlendirmesi olan herkes (geçerli/geçici ayrımı yok).
      cycle.finalizedEmployeeCount = new Set(db.reviews.filter((r) => r.cycleId === cycle.id && r.submittedAt).map((r) => r.employeeId)).size
      // Bekleyen taslaklar silinmez; yalnızca artık gönderilemez (submit → 400).
    }
    save()
    return ok(cycle)
  }),

  /* ------------------------------------ hedefler ---------------------------------- */

  http.get(`${P}/goals`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const employeeId = url.searchParams.get('employeeId')
    const cycleId = url.searchParams.get('cycleId')
    if (!isManager() && employeeId !== me()?.id) return forbidden('Yalnızca kendi hedeflerinizi görebilirsiniz.')
    return ok(getDb().goals.filter((g) => (!employeeId || g.employeeId === employeeId) && (!cycleId || g.cycleId === cycleId)))
  }),

  http.post(`${P}/goals`, async ({ request }) => {
    await latency()
    if (!isManager()) return forbidden('Hedefleri yönetici tanımlar.')
    const b = await readJson(request)
    const db = getDb()
    const cycle = db.cycles.find((c) => c.id === str(b.cycleId))
    if (!cycle) return bad('Geçerli bir dönem seçin.')
    if (cycle.status === 'Closed') return bad('Kapanmış döneme hedef eklenemez.')
    if (!str(b.employeeId)) return bad('Çalışan seçin.')
    if (!str(b.title)) return bad('Hedef başlığı zorunludur.')
    const weight = num(b.weight)
    if (weight === null || weight <= 0) return bad('Ağırlık sıfırdan büyük olmalıdır.')
    const target = num(b.targetValue)
    if (target !== null && target <= 0) return bad('Hedef değer sıfırdan büyük olmalıdır.')
    const row = {
      id: newId(),
      cycleId: cycle.id,
      employeeId: str(b.employeeId),
      title: str(b.title),
      description: str(b.description) || null,
      weight,
      targetValue: target,
      currentValue: target !== null ? 0 : null,
      unit: str(b.unit) || null,
      status: (cycle.status === 'Open' ? 'Active' : 'Draft') as GoalStatus,
    }
    db.goals.push(row)
    save()
    return ok(row, 201)
  }),

  http.post(`${P}/goals/:id/progress`, async ({ request, params }) => {
    await latency()
    if (!isManager()) return forbidden('Hedef ilerlemesini yönetici günceller.')
    const db = getDb()
    const goal = db.goals.find((g) => g.id === params.id)
    if (!goal) return notFound('Hedef bulunamadı.')
    const cycle = db.cycles.find((c) => c.id === goal.cycleId)
    if (cycle?.status === 'Closed') return bad('Kapanmış dönemin hedefleri güncellenemez.')
    const b = await readJson(request)
    const current = num(b.currentValue)
    const status = str(b.status) as GoalStatus
    if (b.currentValue !== undefined && b.currentValue !== null) {
      if (current === null || current < 0) return bad('Gerçekleşen değer negatif olamaz.')
      if (goal.targetValue === null) return bad('Sayısal hedefi olmayan hedefte ilerleme durumla güncellenir.')
      goal.currentValue = current
    }
    if (status) {
      if (!['Draft', 'Active', 'Achieved', 'Missed', 'Cancelled'].includes(status)) return bad('Geçerli bir durum seçin.')
      goal.status = status
    }
    save()
    return ok(goal)
  }),

  /* -------------------------------- değerlendirmeler ------------------------------ */

  http.get(`${P}/reviews/score`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const employeeId = url.searchParams.get('employeeId')
    const cycleId = url.searchParams.get('cycleId')
    if (!employeeId || !cycleId) return bad('employeeId ve cycleId zorunludur.')
    if (!isManager() && employeeId !== me()?.id) return forbidden('Yalnızca kendi puanınızı görebilirsiniz.')
    if (!getDb().cycles.some((c) => c.id === cycleId)) return notFound('Dönem bulunamadı.')
    return ok(computeScore(getDb(), employeeId, cycleId))
  }),

  http.get(`${P}/reviews`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const employeeId = url.searchParams.get('employeeId')
    const cycleId = url.searchParams.get('cycleId')
    const mine = me()?.id
    return ok(
      getDb()
        .reviews.filter((r) => (!employeeId || r.employeeId === employeeId) && (!cycleId || r.cycleId === cycleId))
        // Çalışan yalnızca kendi yazdıklarını ve kendisi hakkındakileri görür.
        .filter((r) => isManager() || r.reviewerEmployeeId === mine || r.employeeId === mine)
        .sort((a, b) => (b.submittedAt ?? b.createdAt).localeCompare(a.submittedAt ?? a.createdAt))
        .map((r) => ({ ...reviewWire(r), scores: [] })),
    )
  }),

  http.get(`${P}/reviews/:id`, async ({ params }) => {
    await latency()
    const r = getDb().reviews.find((x) => x.id === params.id)
    if (!r) return notFound('Değerlendirme bulunamadı.')
    const mine = me()?.id
    if (!isManager() && r.reviewerEmployeeId !== mine) return forbidden('Bu değerlendirmeyi görüntüleme yetkiniz yok.')
    return ok(reviewWire(r))
  }),

  http.post(`${P}/reviews`, async ({ request }) => {
    await latency()
    const b = await readJson(request)
    const db = getDb()
    const cycle = db.cycles.find((c) => c.id === str(b.cycleId))
    const type = str(b.type) as ReviewType
    const employeeId = str(b.employeeId)
    const reviewerEmployeeId = str(b.reviewerEmployeeId)
    if (!cycle) return bad('Geçerli bir dönem seçin.')
    if (cycle.status !== 'Open') return bad('Değerlendirme yalnızca açık dönemde başlatılabilir.')
    if (!employeeId) return bad('Değerlendirilecek çalışanı seçin.')
    if (!reviewerEmployeeId) return bad('Değerlendiren kişi belirtilmeli.')
    if (!REVIEW_TYPES.includes(type)) return bad('Geçerli bir değerlendirme türü seçin.')
    if (type === 'Self' && employeeId !== reviewerEmployeeId) return bad('Öz değerlendirmede değerlendiren ve değerlendirilen aynı kişi olmalıdır.')
    if (type !== 'Self' && employeeId === reviewerEmployeeId) return bad('Kendinizi yalnızca öz değerlendirme türüyle değerlendirebilirsiniz.')
    if (!isManager() && (type === 'Manager' || type === 'TeamLead')) return forbidden('Bu değerlendirme türü yalnızca yöneticilere açık.')
    const dup = db.reviews.find(
      (r) => r.cycleId === cycle.id && r.employeeId === employeeId && r.reviewerEmployeeId === reviewerEmployeeId && r.type === type,
    )
    if (dup) {
      return bad(
        dup.submittedAt
          ? 'Bu çalışanı bu dönemde aynı türle zaten değerlendirdiniz.'
          : 'Bu çalışan için aynı türde açık bir taslağınız var.',
        { existingReviewId: dup.id },
      )
    }
    const row: ReviewRow = {
      id: newId(),
      cycleId: cycle.id,
      employeeId,
      reviewerEmployeeId,
      type,
      submittedAt: null,
      strengths: null,
      improvements: null,
      comments: null,
      scores: [],
      createdAt: nowIso(),
    }
    db.reviews.push(row)
    save()
    return ok(reviewWire(row), 201)
  }),

  /**
   * Taslak: zorunlu metrik kontrolü yok, kilitlemez, tekrar çağrılabilir.
   * Değer aralığı yine kontrol edilir. Kapalı dönemdeki davranış backend'de
   * belirtilmedi; mock, gönderimle aynı gerekçeyle reddeder.
   */
  http.put(`${P}/reviews/:id/draft`, async ({ request, params }) => {
    await latency()
    const db = getDb()
    const r = db.reviews.find((x) => x.id === params.id)
    if (!r) return notFound('Değerlendirme bulunamadı.')
    if (!isManager() && r.reviewerEmployeeId !== me()?.id) return forbidden('Bu değerlendirmeyi düzenleme yetkiniz yok.')
    if (r.submittedAt) return bad('Bu değerlendirme gönderilmiş; değiştirilemez.')
    const cycle = db.cycles.find((c) => c.id === r.cycleId)
    if (cycle?.status === 'Closed') return bad(CYCLE_CLOSED)
    const b = await readJson(request)
    const checked = checkScores(db, r, b)
    if ('error' in checked) return checked.error
    writeReview(r, b, checked.scores)
    save()
    return ok(reviewWire(r))
  }),

  http.post(`${P}/reviews/:id/submit`, async ({ request, params }) => {
    await latency()
    const db = getDb()
    const r = db.reviews.find((x) => x.id === params.id)
    if (!r) return notFound('Değerlendirme bulunamadı.')
    if (!isManager() && r.reviewerEmployeeId !== me()?.id) return forbidden('Bu değerlendirmeyi gönderme yetkiniz yok.')
    if (r.submittedAt) return bad('Bu değerlendirme gönderilmiş; değiştirilemez.')
    const cycle = db.cycles.find((c) => c.id === r.cycleId)
    if (cycle?.status === 'Closed') return bad(CYCLE_CLOSED)
    if (cycle?.status !== 'Open') return bad('Dönem henüz açılmadı; değerlendirme gönderilemez.')
    const b = await readJson(request)
    const checked = checkScores(db, r, b)
    if ('error' in checked) return checked.error

    // Zorunluluk yalnızca değerlendirilen kişinin departmanına ait ya da
    // departmansız (şirket geneli) metrikler için aranır.
    const given = new Set(checked.scores.map((s) => s.metricId))
    const missing = checked.applicable.filter((m) => m.isRequired && !given.has(m.id)).map((m) => m.id)
    if (missing.length) {
      return bad(`Zorunlu ${missing.length} metrik puanlanmadan değerlendirme gönderilemez.`, { missing })
    }

    writeReview(r, b, checked.scores)
    r.submittedAt = nowIso()
    save()
    return ok(reviewWire(r))
  }),

  /* --------------------------------- sürekli izleme ------------------------------ */

  http.get(`${P}/analytics/me`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const emp = me()
    if (!emp) return notFound(NO_RECORD)
    const db = getDb()
    const feedback = db.feedback
      .filter((f) => f.toId === emp.id && f.visibleToEmployee)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(feedbackWire)
    return ok({
      ...employeeAnalytics(db, emp.id, periodOf(new URL(request.url))),
      feedback,
      unreadCount: feedback.filter((f) => !f.isRead).length,
    })
  }),

  http.get(`${P}/analytics/employee/:id/vs-team`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager() && params.id !== me()?.id) return forbidden()
    const db = getDb()
    const url = new URL(request.url)
    const id = String(params.id)
    const teamId =
      url.searchParams.get('teamId') ??
      db.members.find((m) => m.employeeId === id && !m.leftOn)?.teamId
    if (!teamId) return bad('Çalışan herhangi bir ekibe üye değil; karşılaştırma yapılamıyor.')
    return ok(vsTeam(db, id, teamId, periodOf(url)))
  }),

  http.get(`${P}/analytics/employee/:id`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager() && params.id !== me()?.id) return forbidden()
    return ok(employeeAnalytics(getDb(), String(params.id), periodOf(new URL(request.url))))
  }),

  http.get(`${P}/analytics/team/:teamId`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager()) return forbidden()
    const db = getDb()
    if (!db.teams.some((t) => t.id === params.teamId)) return notFound('Ekip bulunamadı.')
    return ok(teamAnalytics(db, String(params.teamId), periodOf(new URL(request.url))))
  }),

  /* -------------------------------- dönem sonuçları ------------------------------ */

  http.get(`${P}/cycle-analytics/me`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const emp = me()
    if (!emp) return notFound(NO_RECORD)
    return ok(employeeCycleHistory(getDb(), emp.id, num(new URL(request.url).searchParams.get('year'))))
  }),

  http.get(`${P}/cycle-analytics/employee/:id`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager() && params.id !== me()?.id) return forbidden()
    return ok(employeeCycleHistory(getDb(), String(params.id), num(new URL(request.url).searchParams.get('year'))))
  }),

  http.get(`${P}/cycle-analytics/cycle/:cycleId`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager()) return forbidden()
    const res = cycleResult(getDb(), String(params.cycleId), new URL(request.url).searchParams.get('teamId'))
    return res ? ok(res) : notFound('Dönem bulunamadı.')
  }),

  http.get(`${P}/cycle-analytics/compare`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager()) return forbidden()
    const url = new URL(request.url)
    const ids = (url.searchParams.get('cycleIds') ?? '').split(',').filter(Boolean)
    if (ids.length < 2) return bad('Karşılaştırma için en az iki dönem seçin.')
    return ok(cycleCompare(getDb(), ids, url.searchParams.get('teamId')))
  }),

  /* ---------------------------------- geri bildirim ------------------------------- */

  http.get(`${P}/feedback/received/:employeeId`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const id = String(params.employeeId)
    const mine = me()?.id
    if (!isManager() && id !== mine) return forbidden('Yalnızca size gelen geri bildirimleri görebilirsiniz.')
    const asManager = url.searchParams.get('asManager') === 'true' && isManager() && id !== mine
    const reason = url.searchParams.get('reason')
    const since = url.searchParams.get('since')
    return ok(
      getDb()
        .feedback.filter((f) => f.toId === id)
        .filter((f) => asManager || f.visibleToEmployee)
        .filter((f) => !reason || f.reason === reason)
        .filter((f) => !since || f.createdAt >= since)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(feedbackWire),
    )
  }),

  http.get(`${P}/feedback/sent/:employeeId`, async ({ params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager() && params.employeeId !== me()?.id) return forbidden()
    return ok(
      getDb()
        .feedback.filter((f) => f.fromId === params.employeeId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(feedbackWire),
    )
  }),

  http.get(`${P}/feedback/summary`, async ({ request }) => {
    await latency()
    const url = new URL(request.url)
    const id = url.searchParams.get('employeeId')
    const since = url.searchParams.get('since')
    if (!id) return bad('employeeId zorunludur.')
    const mine = me()?.id
    const list = getDb()
      .feedback.filter((f) => f.toId === id && (!since || f.createdAt >= since))
      .filter((f) => (isManager() && id !== mine) || f.visibleToEmployee)
    const bySentiment: Record<string, number> = {}
    const byReason: Record<string, number> = {}
    for (const f of list) {
      bySentiment[f.sentiment] = (bySentiment[f.sentiment] ?? 0) + 1
      byReason[f.reason] = (byReason[f.reason] ?? 0) + 1
    }
    return ok({ total: list.length, unread: list.filter((f) => !f.isRead).length, bySentiment, byReason })
  }),

  http.post(`${P}/feedback/:id/mark-read`, async ({ params }) => {
    await latency()
    const f = getDb().feedback.find((x) => x.id === params.id)
    if (!f) return notFound('Geri bildirim bulunamadı.')
    if (f.toId !== me()?.id) return forbidden('Yalnızca size gelen geri bildirimi okundu işaretleyebilirsiniz.')
    if (!f.isRead) {
      f.isRead = true
      f.readAt = nowIso()
      save()
    }
    return noContent()
  }),

  http.post(`${P}/feedback`, async ({ request }) => {
    await latency()
    const emp = me()
    if (!emp) return notFound(NO_RECORD)
    const b = await readJson(request)
    const to = str(b.toEmployeeId)
    const reason = str(b.reason) as FeedbackReason
    const sentiment = str(b.sentiment) as FeedbackSentiment
    const body = str(b.body)
    if (!to) return bad('Geri bildirimin kime yazıldığını seçin.')
    if (to === emp.id) return bad('Kendinize geri bildirim yazamazsınız.')
    if (!REASONS.includes(reason)) return bad('Geçerli bir neden seçin.')
    if (!SENTIMENTS.includes(sentiment)) return bad('Geçerli bir ton seçin.')
    if (sentiment === 'Constructive' && !str(b.reasonDetail)) {
      return bad('Yapıcı eleştiride gerekçe zorunludur; somut bir olay ya da gözlem yazın.')
    }
    if (body.length < 10) return bad('Geri bildirim metni en az 10 karakter olmalıdır.')
    if (b.visibleToEmployee === false && !isManager()) return bad('Yalnızca yöneticiler çalışana gizli not bırakabilir.')
    const row: FeedbackRow = {
      id: newId(),
      fromId: emp.id,
      toId: to,
      reason,
      reasonDetail: str(b.reasonDetail) || null,
      sentiment,
      body,
      metricId: str(b.metricId) || null,
      visibleToEmployee: b.visibleToEmployee !== false,
      isRead: false,
      readAt: null,
      createdAt: nowIso(),
    }
    const db = getDb()
    db.feedback.push(row)
    save()
    return ok(feedbackWire(row), 201)
  }),

  /* ------------------------------------ öneriler ---------------------------------- */

  http.get(`${P}/recommendations/employee/:id`, async ({ params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager()) return forbidden()
    const db = getDb()
    const cycle = currentCycle(db)
    if (!cycle) return notFound('Değerlendirilecek dönem yok.')
    const rec = recommend(db, String(params.id), cycle.id, true, null)
    return rec ? ok(rec) : notFound('Bu çalışanın bu dönemde puanı yok; öneri üretilemedi.')
  }),

  http.get(`${P}/recommendations`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    if (!isManager()) return forbidden()
    const db = getDb()
    const url = new URL(request.url)
    const teamId = url.searchParams.get('teamId')
    const withMl = url.searchParams.get('includeMlSignals') !== 'false'
    const cycle = currentCycle(db)
    const cfg = currentConfig(db)
    if (!cycle) return ok({ configVersion: cfg.version, thresholds: null, items: [] })

    const ids = teamId ? activeMemberIds(db, teamId) : participantsOf(db, cycle)
    const scored = ids.filter((id) => submittedReviews(db, id, cycle.id).length > 0)
    const mlSkip =
      scored.length < ML_MIN_EMPLOYEES
        ? `ML sinyalleri için en az ${ML_MIN_EMPLOYEES} puanlı çalışan gerekiyor (${teamId ? 'bu ekipte' : 'kapsamda'} ${scored.length}).`
        : null
    const items = recommendAll(db, ids, cycle.id, withMl, mlSkip).map(({ employeeName: _n, ...rest }) => rest)
    return ok({
      configVersion: cfg.version,
      thresholds: {
        promotion: cfg.promotionThreshold,
        recognition: cfg.recognitionThreshold,
        improvement: cfg.improvementThreshold,
        critical: cfg.criticalThreshold,
      },
      promotionConsecutivePeriods: cfg.promotionConsecutivePeriods,
      cycleId: cycle.id,
      items,
      mlLayer: withMl ? { note: 'Kararı kural motoru verir; bu sinyaller yalnızca ek bilgidir.', skipReason: mlSkip } : null,
    })
  }),
]

