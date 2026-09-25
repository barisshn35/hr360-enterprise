/**
 * Panelin iskeleti için gereken yan uçlar: çalışan servisi, kiracı, bildirim
 * sayacı. En sonda tanımsız `/api/*` istekleri için anlaşılır bir yanıt var —
 * mock modunda başka bir modül açılırsa canlı gateway'e sızmasın.
 *
 * Yetki canlıdakiyle aynı:
 *   /employees            → RequireManagerOrAbove (çalışan rolüne 403)
 *   /employees/directory  → her kimlik doğrulanmış kullanıcı; yalnızca ad döner
 */

import { http, HttpResponse } from 'msw'
import { EMPLOYEES } from '../data/people'
import { readMockRole } from '../session'
import { forbidden, latency, notFound, ok } from '../util'

export const shellHandlers = [
  // Özel yol, `:id`'den önce tanımlı olmalı.
  http.get('/api/employee/employees/directory', async () => {
    await latency()
    return ok(
      EMPLOYEES.map((e) => ({ id: e.id, firstName: e.firstName, lastName: e.lastName, fullName: `${e.firstName} ${e.lastName}` })),
    )
  }),

  http.get('/api/employee/employees', async ({ request }) => {
    await latency()
    if (readMockRole() === 'employee') return forbidden('Çalışan listesini görüntüleme yetkiniz yok.')
    const email = new URL(request.url).searchParams.get('email')
    return ok(email ? EMPLOYEES.filter((e) => e.email.toLocaleLowerCase('tr-TR') === email.toLocaleLowerCase('tr-TR')) : EMPLOYEES)
  }),

  http.get('/api/employee/employees/:id', async ({ params }) => {
    await latency()
    if (readMockRole() === 'employee') return forbidden('Çalışan kaydını görüntüleme yetkiniz yok.')
    const e = EMPLOYEES.find((x) => x.id === params.id)
    return e ? ok(e) : notFound('Çalışan bulunamadı.')
  }),

  http.get('/api/tenant/my-tenant', async () => {
    await latency()
    return ok({
      id: '4c1d9a0e-7b1f-4f5e-a3c2-acme00000001',
      name: 'Acme Holding A.Ş.',
      slug: 'acme',
      status: 'Active',
      plan: 'Enterprise',
      maxEmployees: 10_000,
      employeeCount: EMPLOYEES.filter((e) => e.status !== 2).length,
      emailDomain: 'acme.com.tr',
      createdAt: '2024-03-12T09:00:00Z',
    })
  }),

  http.get('/api/notification/notifications/unread-count', () => ok({ count: 2 })),
  http.get('/api/notification/notifications', () => ok([])),

  /* Mock modunda tanımlanmamış her şey: listeler boş, yazma işlemleri açık bir hatayla. */
  http.get('/api/*', () => ok([])),
  http.all('/api/*', () => HttpResponse.json({ message: 'Mock modunda bu işlem tanımlı değil.' }, { status: 501 })),
]
