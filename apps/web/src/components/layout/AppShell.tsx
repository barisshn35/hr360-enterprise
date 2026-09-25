import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useMyEmployeeId, useUnreadCount } from '@/api/queries'
import { useDirectory } from '@/api/directory'
import { useAuth } from '@/auth/useAuth'
import { PageTransition } from '@/motion/primitives'
import { SidebarNav } from './SidebarNav'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'

/**
 * Panelin dış kabuğu.
 *
 * SidebarNav (21st.dev shell uyarlaması) sabit 260px genişlikte ve mobil
 * davranışı yok — küçük ekranda çekmeceye o yüzden burada alınıyor.
 */
export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()
  const { can, status, tenantSlug, roles } = useAuth()

  // NOT: `user.id` Keycloak `sub` claim'i, bildirimlerin yazıldığı Employee.Id
  // DEĞİL - kenar çubuğundaki bildirim rozeti bu yüzden gerçek çalışanlar için
  // her zaman "0" gösteriyordu (hardcore test, 3. tur - bkz. NotificationBell.tsx
  // ve NotificationsPage.tsx'teki aynı kök nedenli düzeltme).
  const canSeeNotifications = can('notification:view')
  const { employeeId: myEmployeeId } = useMyEmployeeId(canSeeNotifications)
  const unread = useUnreadCount(canSeeNotifications ? myEmployeeId : undefined)
  // Çalışan dizini açılışta bir kez çekilir; tüm ekranlar kimlikten adı buradan çözer.
  useDirectory()

  // Çekmecede bir modüle tıklanınca kapansın — SidebarNav kendi kapanışını bilmiyor.
  useEffect(() => setMobileNavOpen(false), [location.pathname])

  /**
   * `organization` claim'i gelmediyse backend hiçbir kaydı döndürmez ama HATA
   * DA VERMEZ; kullanıcı her ekranı boş görür. Sessiz kalmak yerine söylüyoruz.
   */
  // Platform yöneticisi hiçbir kiracıya bağlı değildir (ayrı platform.admin hesabı);
  // onun için bu uyarı yanlış alarm olurdu.
  const tenantClaimMissing =
    status === 'authenticated' && !tenantSlug && !roles.includes('platform-admin')

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] lg:block">
        <SidebarNav
          onOpenCommandPalette={() => setPaletteOpen(true)}
          unreadCount={unread.data?.unreadCount ?? 0}
        />
      </aside>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-[260px] p-0 lg:hidden">
          <SheetTitle className="sr-only">Modül menüsü</SheetTitle>
          <SidebarNav
            className="w-full border-r-0"
            onOpenCommandPalette={() => {
              setMobileNavOpen(false)
              setPaletteOpen(true)
            }}
            unreadCount={unread.data?.unreadCount ?? 0}
          />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[260px]">
        <Topbar
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenCommandPalette={() => setPaletteOpen(true)}
        />

        {tenantClaimMissing && (
          <div
            role="alert"
            className="flex items-start gap-2.5 border-b border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 px-4 py-3 text-[13px] leading-relaxed sm:px-6"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]"
            />
            <p>
              <strong className="font-semibold">Oturumunuzda kiracı bilgisi yok.</strong>{' '}
              Kimlik doğrulama <code className="font-mono text-[12px]">organization</code> kapsamı
              olmadan tamamlandığı için listeler boş görünecek. Oturumu kapatıp yeniden girin;
              sorun sürerse sistem yöneticinize bildirin.
            </p>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {/* Rota değişiminde içerik yerine otururken kısa bir yükselme. */}
          <PageTransition routeKey={location.pathname}>
            <Outlet />
          </PageTransition>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
