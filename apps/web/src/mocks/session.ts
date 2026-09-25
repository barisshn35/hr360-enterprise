/**
 * Sahte oturum — `VITE_MOCK_AUTH=true` iken Keycloak'a hiç gidilmez.
 *
 * Rol URL'den değişir: `?rol=employee | manager | hr-admin`. Seçim sekme
 * boyunca hatırlanır. Her rol, örnek şirketteki gerçek bir çalışana bağlı
 * (backend'deki gibi e-posta eşleşmesiyle) — "benim" ekranları o kişinin
 * verisini gösterir.
 */

import { readScenario } from './scenario'
import { uid } from './util'

export type MockRole = 'employee' | 'manager' | 'hr-admin'

export const MOCK_ROLES: MockRole[] = ['employee', 'manager', 'hr-admin']

const KEY = 'hr360.mock.rol'

export function readMockRole(): MockRole {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('rol')
    if (fromUrl && (MOCK_ROLES as string[]).includes(fromUrl)) {
      window.sessionStorage.setItem(KEY, fromUrl)
      return fromUrl as MockRole
    }
    const stored = window.sessionStorage.getItem(KEY)
    if (stored && (MOCK_ROLES as string[]).includes(stored)) return stored as MockRole
  } catch {
    /* depolama kapalı */
  }
  return 'hr-admin'
}

export interface MockUser {
  sub: string
  username: string
  name: string
  email: string
  roles: string[]
}

const USERS: Record<MockRole, Omit<MockUser, 'sub'>> = {
  employee: { username: 'elif.kaya', name: 'Elif Kaya', email: 'elif.kaya@acme.com.tr', roles: ['employee'] },
  manager: { username: 'mert.sahin', name: 'Mert Şahin', email: 'mert.sahin@acme.com.tr', roles: ['manager'] },
  'hr-admin': { username: 'derya.aksoy', name: 'Derya Aksoy', email: 'derya.aksoy@acme.com.tr', roles: ['hr-admin'] },
}

export function mockUser(): MockUser {
  const role = readMockRole()
  const base = USERS[role]
  // "kayitsiz" senaryosu: e-posta hiçbir çalışan kaydıyla eşleşmez → /me uçları 404.
  const email = readScenario() === 'kayitsiz' ? 'yeni.kullanici@acme.com.tr' : base.email
  return { ...base, email, sub: uid('user', `${role}:${email}`) }
}

export const MOCK_TENANT_SLUG = 'acme'

export const mockRoleLabels: Record<MockRole, string> = {
  employee: 'Çalışan',
  manager: 'Yönetici',
  'hr-admin': 'İK Yöneticisi',
}
