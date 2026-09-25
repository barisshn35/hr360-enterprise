import { type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton'
import { useAuth } from './useAuth'

/**
 * Panel rotalarını korur.
 *
 * Oturum yoksa kullanıcı /giris sayfasına gönderilir; istenen adres
 * "devam" parametresinde taşınır, giriş sonrası oraya dönülür. Böylece
 * derin bağlantı korunur ve tüm girişler tek bir kapıdan geçer.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'authenticated') return <>{children}</>

  if (status === 'anonymous' || status === 'error') {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/giris?devam=${next}`} replace />
  }

  return <AppShellSkeleton label="Oturum doğrulanıyor" />
}
