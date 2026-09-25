import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { useMyTenant, useTenants } from '@/api/queries-tenant'
import { applyTenantBrandColor } from '@/lib/tenant-brand'
import {
  initKeycloak,
  keycloak,
  readTenantSlug,
  scopeForTenant,
  writePreferredTenant,
} from './keycloak'
import { hasPermission, type Permission, type Role } from './roles'
import { AuthContext, type AuthContextValue, type AuthUser } from './AuthContext'

interface TokenClaims {
  sub?: string
  preferred_username?: string
  name?: string
  given_name?: string
  family_name?: string
  email?: string
  realm_access?: { roles?: string[] }
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('tr-TR'))
    .join('')
}

/** Keycloak token'ından uygulama kullanıcısını türetir. */
function readUser(): AuthUser | null {
  const parsed = keycloak.tokenParsed as TokenClaims | undefined
  if (!parsed?.sub) return null

  const fullName =
    parsed.name ||
    [parsed.given_name, parsed.family_name].filter(Boolean).join(' ') ||
    parsed.preferred_username ||
    'Kullanıcı'

  return {
    id: parsed.sub,
    username: parsed.preferred_username ?? parsed.sub,
    fullName,
    email: parsed.email ?? null,
    roles: (parsed.realm_access?.roles ?? []) as Role[],
    initials: initialsOf(fullName) || 'HR',
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [tenantSlug, setTenantSlug] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    /*
     * Sahte oturum (`VITE_MOCK_AUTH=true`): Keycloak'a hiç gidilmez. Rol
     * `?rol=` ile değişir. Anahtar kapalıyken bu dal derlemede tamamen düşer.
     */
    if (__MOCK_AUTH__) {
      void import('@/mocks/session').then(({ mockUser, MOCK_TENANT_SLUG }) => {
        if (cancelled) return
        const u = mockUser()
        setUser({
          id: u.sub,
          username: u.username,
          fullName: u.name,
          email: u.email,
          roles: u.roles as Role[],
          initials: initialsOf(u.name) || 'HR',
        })
        setTenantSlug(MOCK_TENANT_SLUG)
        setStatus('authenticated')
      })
      return () => {
        cancelled = true
      }
    }

    const sync = () => {
      setUser(readUser())
      setTenantSlug(readTenantSlug())
    }

    // Token yenilendiğinde/süresi dolduğunda React state'i senkron tut.
    keycloak.onAuthRefreshSuccess = sync
    keycloak.onAuthLogout = () => {
      setUser(null)
      setTenantSlug(null)
      setStatus('anonymous')
    }
    keycloak.onTokenExpired = () => {
      void keycloak.updateToken(30).catch(() => keycloak.clearToken())
    }

    initKeycloak()
      .then((authenticated) => {
        if (cancelled) return
        if (authenticated) sync()
        else {
          setUser(null)
          setTenantSlug(null)
        }
        setStatus(authenticated ? 'authenticated' : 'anonymous')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(
          e instanceof Error
            ? e.message
            : 'Kimlik sağlayıcıya ulaşılamadı. Ağ bağlantınızı kontrol edin.',
        )
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [])

  const roles = useMemo(() => user?.roles ?? [], [user])
  const can = useCallback((permission: Permission) => hasPermission(roles, permission), [roles])

  const isAuthenticated = status === 'authenticated'
  const canSwitchTenant = isAuthenticated && can('platform:manage')

  // Kiracıya bağlı olmayan oturum (platform.admin) için /my-tenant her sayfada 404
  // dönüyordu; kiracı bilgisi yoksa istenmez.
  const myTenant = useMyTenant(isAuthenticated && Boolean(tenantSlug))
  const allTenants = useTenants({}, canSwitchTenant)

  // Enterprise plan bir marka rengi ayarlamışsa çalışma zamanında uygula;
  // oturum kapanınca (data undefined olunca) varsayılana döner.
  useEffect(() => {
    applyTenantBrandColor(myTenant.data?.primaryColorHex)
  }, [myTenant.data?.primaryColorHex])

  const login = useCallback((redirectTo?: string) => {
    if (__MOCK_AUTH__) {
      window.location.assign(redirectTo ?? '/panel')
      return
    }
    void keycloak.login({
      redirectUri: redirectTo ? new URL(redirectTo, window.location.origin).href : window.location.href,
      locale: 'tr',
      // organization scope'u burada da şart: giriş buradan başlıyorsa
      // init'teki scope hiç devreye girmiyor.
      scope: scopeForTenant(null),
    })
  }, [])

  const logout = useCallback(() => {
    if (__MOCK_AUTH__) {
      window.location.assign('/')
      return
    }
    writePreferredTenant(null)
    void keycloak.logout({ redirectUri: window.location.origin })
  }, [])

  /**
   * Kiracı değiştirme yalnızca platform yöneticisinde açık.
   *
   * Veri izolasyonu JWT'deki `organization` claim'ine bağlı olduğu için
   * kiracıyı değiştirmenin tek yolu YENİ TOKEN almak — istemci tarafında
   * bir bayrak çevirmek hiçbir şeyi değiştirmez, backend yine eski kiracıyı
   * görür. Bu yüzden seçim saklanıp Keycloak'a `organization:<slug>`
   * scope'uyla yeniden gidiliyor.
   */
  const switchTenant = useCallback((slug: string) => {
    writePreferredTenant(slug)
    void keycloak.login({
      redirectUri: window.location.href,
      locale: 'tr',
      scope: scopeForTenant(slug),
    })
  }, [])

  const tenantError = useMemo(() => {
    const err = myTenant.error
    if (!err) return null
    if (err instanceof ApiError) {
      return err.status === 404 || err.status === 502
        ? 'Kiracı servisine ulaşılamıyor. Gateway’de /api/tenant/* yönlendirmesi tanımlı olmayabilir.'
        : err.message
    }
    return 'Kiracı bilgisi alınamadı.'
  }, [myTenant.error])

  const value = useMemo<AuthContextValue>(() => {
    // Oturum yokken createAccountUrl() exception fırlatır — güvenli sarmalayıcı.
    let accountUrl = '#'
    if (isAuthenticated && !__MOCK_AUTH__) {
      try {
        accountUrl = keycloak.createAccountUrl() ?? '#'
      } catch {
        accountUrl = '#'
      }
    }

    return {
      status,
      user,
      error,
      login,
      logout,
      accountUrl,
      can,
      hasRole: (role: Role) => roles.includes(role),
      roles,
      tenantSlug,
      tenant: myTenant.data ?? null,
      tenantLoading: myTenant.isPending && isAuthenticated,
      tenantError,
      canSwitchTenant,
      availableTenants: allTenants.data ?? [],
      switchTenant,
    }
  }, [
    status, user, error, login, logout, can, roles, tenantSlug,
    myTenant.data, myTenant.isPending, tenantError, canSwitchTenant,
    allTenants.data, switchTenant, isAuthenticated,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
