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
import { COMPANIES, isFormer } from '../data/people'
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
