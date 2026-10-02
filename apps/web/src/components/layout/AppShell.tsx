import { Suspense, lazy, useState } from 'react'
import { useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TriangleAlert } from 'lucide-react'
import { useMyEmployeeId, useUnreadCount } from '@/api/queries'
import { useDirectory } from '@/api/directory'
import { useAuth } from '@/auth/useAuth'
import { AmbientBackground } from '@/components/fx/ambient-background'
import { TopNav } from './TopNav'
import { AppDock } from './AppDock'
import { CommandPalette } from './CommandPalette'

/**
 * Panelin dış kabuğu ("Zümrüt Yörünge" düzeni).
 *
 * Sol kenar çubuğu yok: modüllere üstte yüzen menüden (bölüm sekmeleri +
 * mega menü), en sık kullanılanlara alttaki rıhtımdan (dock) gidilir. Zemin
 * canlı (aurora, ızgara, meteorlar, imleç ışığı); sayfalar bulanıklıktan
 * netleşerek geçer.
 */
/**
 * Çıkış animasyonu sırasında eski sayfa görünmeye devam etsin: Outlet her
 * render'da GÜNCEL rotayı basar, bu yüzden ilk değer saklanır.
 */
/** İK asistanı ayrı paket: ilk yükleme ağırlaşmasın. */
const AssistantWidget = lazy(async () => ({ default: (await import('./AssistantWidget')).AssistantWidget }))

function FrozenOutlet() {
  const outlet = useOutlet()
  const [frozen] = useState(outlet)
  return frozen
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const location = useLocation()
  const reduced = useReducedMotion()
  const { can, status, tenantSlug, roles } = useAuth()

  // NOT: `user.id` Keycloak `sub` claim'i, bildirimlerin yazıldığı Employee.Id
  // DEĞİL - rozet bu yüzden çalışan kimliğiyle sorgulanır (bkz. NotificationBell.tsx).
  const canSeeNotifications = can('notification:view')
  const { employeeId: myEmployeeId } = useMyEmployeeId(canSeeNotifications)
  const unread = useUnreadCount(canSeeNotifications ? myEmployeeId : undefined)
  // Çalışan dizini açılışta bir kez çekilir; tüm ekranlar kimlikten adı buradan çözer.
  useDirectory()

  /**
   * `organization` claim'i gelmediyse backend hiçbir kaydı döndürmez ama HATA
   * DA VERMEZ; kullanıcı her ekranı boş görür. Sessiz kalmak yerine söylüyoruz.
   * Platform yöneticisi hiçbir kiracıya bağlı değildir; onun için yanlış alarm olurdu.
   */
  const tenantClaimMissing =
    status === 'authenticated' && !tenantSlug && !roles.includes('platform-admin')

  return (
    <div className="relative min-h-dvh bg-background">
      <AmbientBackground />

      <div className="relative z-10 flex min-h-dvh flex-col">
        <TopNav onOpenCommandPalette={() => setPaletteOpen(true)} />

        {tenantClaimMissing && (
          <div className="mx-auto mt-3 w-full max-w-[1480px] px-3 sm:px-5">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 px-4 py-3 text-[13px] leading-relaxed"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]" />
              <p>
                <strong className="font-semibold">Oturumunuzda kiracı bilgisi yok.</strong> Kimlik doğrulama{' '}
                <code className="font-mono text-[12px]">organization</code> kapsamı olmadan tamamlandığı için listeler boş
                görünecek. Oturumu kapatıp yeniden girin; sorun sürerse sistem yöneticinize bildirin.
              </p>
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1480px] min-w-0 flex-1 px-4 pt-7 pb-32 sm:px-6 lg:px-8 lg:pt-9">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduced ? false : { opacity: 0, y: 14, filter: 'blur(8px)', scale: 0.995 }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', scale: 1 }}
              exit={reduced ? undefined : { opacity: 0, y: -8, filter: 'blur(6px)', transition: { duration: 0.16 } }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            >
              <FrozenOutlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AppDock unreadCount={unread.data?.unreadCount ?? 0} onOpenCommandPalette={() => setPaletteOpen(true)} />
      <Suspense fallback={null}><AssistantWidget /></Suspense>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}
