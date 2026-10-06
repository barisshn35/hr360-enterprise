/**
 * Organizasyon servisi — ekip uçları (`/api/organization/teams/*`) ve
 * panelin iskeletinin ihtiyaç duyduğu şirket listesi.
 *
 * Ekip yanıtları çalışan ADI taşımaz (organizasyon servisi çalışan servisinin
 * verisine sahip değil); arayüz adları çalışan listesinden çözer. Mock bunu
 * bilerek taklit ediyor ki ekranlar ada güvenmesin.
 */

import { http, HttpResponse } from 'msw'
import { getDb, save, type MemberRow, type TeamRow } from '../db'
import { COMPANIES, DEPARTMENTS, DEPT, EMPLOYEES, isFormer } from '../data/people'
import { readScenario } from '../scenario'
import { readMockRole } from '../session'
import { bad, forbidden, latency, newId, notFound, ok, readJson, serverError, today } from '../util'

const O = '/api/organization'

const canManage = () => readMockRole() !== 'employee'
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function failIfScenario() {
  return readScenario() === 'hata' ? serverError('Organizasyon servisi şu an yanıt vermiyor.') : null
}

function memberWire(m: MemberRow, team: TeamRow) {
  return {
    id: m.id,
    employeeId: m.employeeId,
    roleInTeam: m.roleInTeam,
    joinedOn: m.joinedOn,
    leftOn: m.leftOn,
    isLead: team.leadEmployeeId === m.employeeId && !m.leftOn,
  }
}

function teamWire(t: TeamRow, opts: { withMembers?: boolean; includeFormer?: boolean } = {}) {
  const all = getDb().members.filter((m) => m.teamId === t.id)
  const active = all.filter((m) => !m.leftOn)
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    departmentId: t.departmentId,
    leadEmployeeId: t.leadEmployeeId,
    isActive: t.isActive,
    memberCount: active.length,
    ...(opts.withMembers
      ? {
          members: (opts.includeFormer ? all : active)
            .sort((a, b) => Number(Boolean(a.leftOn)) - Number(Boolean(b.leftOn)) || a.joinedOn.localeCompare(b.joinedOn))
            .map((m) => memberWire(m, t)),
        }
      : {}),
  }
}

/** Lider atanınca otomatik üye olur. */
function ensureMember(team: TeamRow, employeeId: string) {
  const db = getDb()
  const existing = db.members.find((m) => m.teamId === team.id && m.employeeId === employeeId && !m.leftOn)
  if (existing) return existing
  const row: MemberRow = { id: newId(), teamId: team.id, employeeId, roleInTeam: 'Takım lideri', joinedOn: today(), leftOn: null }
  db.members.push(row)
  return row
}

const mockLinks: Array<{ id: string; fromDepartmentId: string; toDepartmentId: string; kind: string; note: string | null; createdAt: string }> = [
  { id: 'mock-link-1', fromDepartmentId: DEPT.mobil, toDepartmentId: DEPT.urun, kind: 'Functional', note: 'Mobil ürün yol haritası', createdAt: '2026-01-10T09:00:00Z' },
  { id: 'mock-link-2', fromDepartmentId: DEPT.satis, toDepartmentId: DEPT.yazilim, kind: 'Project', note: 'CRM projesi', createdAt: '2026-02-01T09:00:00Z' },
]

/** Org şeması 3B dalgası: zaman makinesi, senaryolar ve ekip ağı için örnek yanıtlar (gerçek veri değil). */
function mockSnapshot(date: string) {
  const people = EMPLOYEES.filter((e) => (e.hireDate ?? '') <= date)
  const groups = new Map<string, typeof people>()
  for (const e of people) {
    const d = e.assignments?.find((a) => !a.effectiveTo)?.departmentId ?? ''
    groups.set(d, [...(groups.get(d) ?? []), e])
  }
  return {
    date,
    headcount: people.length,
    headcountToday: EMPLOYEES.length,
    departmentIds: DEPARTMENTS.filter((d) => d.id !== DEPT.mobil || date >= '2025-01-01').map((d) => d.id),
    departments: [...groups].map(([id, list]) => ({
      departmentId: id || null,
      department: DEPARTMENTS.find((d) => d.id === id)?.name ?? 'Atanmamış',
      count: list.length,
      head: null,
      people: list.map((e) => ({ employeeId: e.id, name: `${e.firstName} ${e.lastName}`, position: null, hireDate: e.hireDate, isHead: false })),
    })),
    changesSince: [],
  }
}

export const orgWave3Handlers = [
  http.get('/api/governance/time-machine', async ({ request }) => {
    await latency()
    return ok(mockSnapshot(new URL(request.url).searchParams.get('date') ?? today()))
  }),
  http.get('/api/engagement/org-scenarios', async () => {
    await latency()
    const [a, b] = EMPLOYEES.filter((e) => !isFormer(e.id))
    return ok([
      {
        id: '5ce7a810-0000-4000-8000-000000000001',
        name: 'Mobil ekibini büyütme',
        description: null,
        status: 'Draft',
        createdByName: 'Mock',
        createdAt: '2026-09-01T09:00:00Z',
        updatedAt: '2026-09-01T09:00:00Z',
        moves: [
          { employeeId: a.id, name: `${a.firstName} ${a.lastName}`, toDepartmentId: DEPT.mobil, kind: 'Move' },
          { employeeId: b.id, name: `${b.firstName} ${b.lastName}`, kind: 'Exit' },
          { employeeId: '', name: 'Yeni mobil geliştirici', toDepartmentId: DEPT.mobil, kind: 'Hire' },
        ],
      },
    ])
  }),
  http.get('/api/governance/team-network', async ({ request }) => {
    await latency()
    const days = Number(new URL(request.url).searchParams.get('days') ?? 90)
    const teams = getDb().teams.filter((t) => t.isActive)
    const nodes = teams.map((t, i) => ({
      id: t.id,
      name: t.name,
      department: DEPARTMENTS.find((d) => d.id === t.departmentId)?.name ?? null,
      members: 5 + ((i * 7) % 11),
      mergedTeams: 1,
      internal: { kudos: 3 + i, oneOnOnes: i % 2 ? 4 : 0, sharedGoals: 0 },
    }))
    const edges = nodes.flatMap((a, i) =>
      nodes.slice(i + 1).map((b, j) => ({ source: a.id, target: b.id, kudos: (i + j) % 3 ? 3 + i + j : 0, oneOnOnes: (i * j) % 2 ? 3 : 0, sharedGoals: j % 2 ? 4 : 0 })),
    )
      .map((e) => ({ ...e, weight: e.kudos + e.oneOnOnes + e.sharedGoals }))
      .filter((e) => e.weight > 0)
    return ok({ days, since: '2026-07-08', minTeamSize: 5, minEdgeCount: 3, nodes, edges, hiddenTeams: 1, hiddenEdges: 2 })
  }),
]

export const organizationHandlers = [
  http.get(`${O}/companies`, async () => {
    await latency()
    return ok(COMPANIES)
  }),

  http.get(`${O}/companies/:id`, async ({ params }) => {
    await latency()
    const c = COMPANIES.find((x) => x.id === params.id)
    return c ? ok(c) : notFound('Şirket bulunamadı.')
  }),

  // Departman listesi (organizasyon şeması) ve matris bağları (dalga 2). Bağlar oturum belleğinde.
  http.get(`${O}/departments`, async ({ request }) => {
    await latency()
    const companyId = new URL(request.url).searchParams.get('companyId')
    return ok(DEPARTMENTS.filter((d) => !companyId || d.companyId === companyId))
  }),

  http.get(`${O}/department-links`, async () => {
    await latency()
    return ok(mockLinks)
  }),

  http.post(`${O}/department-links`, async ({ request }) => {
    await latency()
    if (readMockRole() !== 'hr-admin') return forbidden()
    const body = await readJson(request)
    const from = str(body.fromDepartmentId)
    const to = str(body.toDepartmentId)
    if (!from || !to) return bad('Her iki departman da seçilmeli.')
    if (from === to) return bad('Bir departman kendisine bağlanamaz.')
    const kind = body.kind === 'Project' ? 'Project' : 'Functional'
    if (mockLinks.some((l) => l.fromDepartmentId === from && l.toDepartmentId === to && l.kind === kind)) return bad('Bu bağ zaten var.')
    const row = { id: newId(), fromDepartmentId: from, toDepartmentId: to, kind, note: str(body.note) || null, createdAt: new Date().toISOString() }
    mockLinks.push(row)
    return ok(row)
  }),

  http.delete(`${O}/department-links/:id`, async ({ params }) => {
    await latency()
    if (readMockRole() !== 'hr-admin') return forbidden()
    const i = mockLinks.findIndex((l) => l.id === params.id)
    if (i < 0) return notFound('Bağ bulunamadı.')
    mockLinks.splice(i, 1)
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${O}/teams`, async ({ request }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const url = new URL(request.url)
    const dept = url.searchParams.get('departmentId')
    const lead = url.searchParams.get('leadEmployeeId')
    const includeInactive = url.searchParams.get('includeInactive') === 'true'
    // Canlıdaki gibi: includeMembers verilmezse members: null döner.
    const includeMembers = url.searchParams.get('includeMembers') === 'true'
    return ok(
      getDb()
        .teams.filter((t) => (includeInactive || t.isActive) && (!dept || t.departmentId === dept) && (!lead || t.leadEmployeeId === lead))
        .map((t) => (includeMembers ? teamWire(t, { withMembers: true }) : { ...teamWire(t), members: null })),
    )
  }),

  http.get(`${O}/teams/by-employee/:employeeId`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const includeFormer = new URL(request.url).searchParams.get('includeFormer') === 'true'
    const db = getDb()
    const teamIds = new Set(
      db.members.filter((m) => m.employeeId === params.employeeId && (includeFormer || !m.leftOn)).map((m) => m.teamId),
    )
    return ok(db.teams.filter((t) => teamIds.has(t.id)).map((t) => teamWire(t)))
  }),

  http.get(`${O}/teams/:id`, async ({ request, params }) => {
    await latency()
    const fail = failIfScenario()
    if (fail) return fail
    const team = getDb().teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    const includeFormer = new URL(request.url).searchParams.get('includeFormer') === 'true'
    return ok(teamWire(team, { withMembers: true, includeFormer }))
  }),

  http.post(`${O}/teams`, async ({ request }) => {
    await latency()
    if (!canManage()) return forbidden()
    const b = await readJson(request)
    const name = str(b.name)
    const departmentId = str(b.departmentId)
    if (!name) return bad('Ekip adı zorunludur.')
    if (!departmentId) return bad('Departman seçin.')
    const db = getDb()
    if (db.teams.some((t) => t.departmentId === departmentId && t.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'))) {
      return bad('Bu departmanda aynı adla bir ekip zaten var.')
    }
    const row: TeamRow = { id: newId(), name, description: str(b.description) || null, departmentId, leadEmployeeId: null, isActive: true }
    db.teams.push(row)
    save()
    return ok(teamWire(row, { withMembers: true }), 201)
  }),

  http.put(`${O}/teams/:id`, async ({ request, params }) => {
    await latency()
    if (!canManage()) return forbidden()
    const db = getDb()
    const team = db.teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    const b = await readJson(request)
    // UpdateTeamRequest(Name?, Description?, IsActive?) — departman değişmez.
    if (b.name !== undefined) {
      const name = str(b.name)
      if (!name) return bad('Ekip adı boş olamaz.')
      team.name = name
    }
    if (b.description !== undefined) team.description = str(b.description) || null
    if (typeof b.isActive === 'boolean') team.isActive = b.isActive
    save()
    return ok(teamWire(team, { withMembers: true }))
  }),

  http.post(`${O}/teams/:id/lead`, async ({ request, params }) => {
    await latency()
    if (!canManage()) return forbidden()
    const db = getDb()
    const team = db.teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    const lead = (await readJson(request)).leadEmployeeId
    if (lead === null || lead === undefined || lead === '') {
      team.leadEmployeeId = null
    } else {
      if (typeof lead !== 'string') return bad('Geçerli bir çalışan seçin.')
      if (isFormer(lead)) return bad('Ayrılmış bir çalışan lider atanamaz.')
      ensureMember(team, lead)
      team.leadEmployeeId = lead
    }
    save()
    return ok(teamWire(team, { withMembers: true }))
  }),

  http.post(`${O}/teams/:id/members`, async ({ request, params }) => {
    await latency()
    if (!canManage()) return forbidden()
    const db = getDb()
    const team = db.teams.find((t) => t.id === params.id)
    if (!team) return notFound('Ekip bulunamadı.')
    if (!team.isActive) return bad('Pasif ekibe üye eklenemez.')
    const b = await readJson(request)
    const employeeId = str(b.employeeId)
    if (!employeeId) return bad('Çalışan seçin.')
    if (isFormer(employeeId)) return bad('Ayrılmış bir çalışan ekibe eklenemez.')
    if (db.members.some((m) => m.teamId === team.id && m.employeeId === employeeId && !m.leftOn)) {
      return HttpResponse.json({ message: 'Bu çalışan zaten ekibin üyesi.' }, { status: 409 })
    }
    const joinedOn = str(b.joinedOn) || today()
    const row: MemberRow = { id: newId(), teamId: team.id, employeeId, roleInTeam: str(b.roleInTeam) || null, joinedOn, leftOn: null }
    db.members.push(row)
    save()
    return ok(memberWire(row, team), 201)
  }),

  http.post(`${O}/teams/:id/members/:memberId/remove`, async ({ request, params }) => {
    await latency()
    if (!canManage()) return forbidden()
    const db = getDb()
    const team = db.teams.find((t) => t.id === params.id)
    const member = db.members.find((m) => m.id === params.memberId && m.teamId === params.id)
    if (!team || !member) return notFound('Üyelik bulunamadı.')
    if (member.leftOn) return bad('Bu üye zaten ekipten ayrılmış.')
    const leftOn = str((await readJson(request)).leftOn) || today()
    if (leftOn < member.joinedOn) return bad('Ayrılma tarihi katılma tarihinden önce olamaz.')
    member.leftOn = leftOn
    // Lider ayrılırsa ekip lidersiz kalır — kayıt silinmez.
    if (team.leadEmployeeId === member.employeeId) team.leadEmployeeId = null
    save()
    return ok(memberWire(member, team))
  }),
]
