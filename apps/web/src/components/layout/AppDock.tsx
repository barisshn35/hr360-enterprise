/**
 * Alt rıhtım: en sık kullanılan modüllere tek dokunuşla gidiş.
 * Görsel bileşen: components/fx/floating-dock (21st.dev "Floating Dock").
 * Masaüstünde büyüyen ikonlar, dar ekranda sabit alt sekme çubuğu.
 */
import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Command, Settings } from 'lucide-react'
import { FloatingDock, type DockItem } from '@/components/fx/floating-dock'
import { useAuth } from '@/auth/useAuth'
import { cn } from '@/lib/utils'
import { filterByPermission, flattenItems, locate, navGroups, overviewItem } from './nav-config'

/** Rıhtıma girecek modüller, öncelik sırasıyla; yetkisi olmayanlar atlanır. */
const PREFERRED = ['approvals', 'leave', 'expense', 'employees', 'timeshift', 'perf-me', 'learning', 'tenants', 'notifications']

export function AppDock({ unreadCount, onOpenCommandPalette }: { unreadCount: number; onOpenCommandPalette: () => void }) {
  const { can, roles } = useAuth()
  const { pathname } = useLocation()
  const here = locate(pathname)

  const modules = useMemo(() => {
    const flat = flattenItems(filterByPermission(navGroups, can, roles))
    return PREFERRED.map((id) => flat.find((f) => f.id === id)).filter(Boolean) as typeof flat
  }, [can, roles])

  const desktop: DockItem[] = [
    { id: overviewItem.id, title: overviewItem.title, icon: overviewItem.icon, href: '/panel', active: here.item?.id === 'overview' },
    { kind: 'separator', id: 'sep-1' },
    ...modules.slice(0, 7).map<DockItem>((m) => ({
      id: m.id,
      title: m.title,
      icon: m.icon,
      href: m.path!,
      active: here.item?.id === m.id,
      badge: m.id === 'notifications' ? unreadCount : undefined,
    })),
    { kind: 'separator', id: 'sep-2' },
    { kind: 'action', id: 'search', title: 'Komut paleti (⌘K)', icon: Command, onClick: onOpenCommandPalette },
    { id: 'settings', title: 'Ayarlar', icon: Settings, href: '/panel/ayarlar', active: pathname.startsWith('/panel/ayarlar') },
  ]

  const mobile = [
    { id: 'overview', title: 'Özet', icon: overviewItem.icon, href: '/panel' },
    ...modules.slice(0, 3).map((m) => ({ id: m.id, title: m.title, icon: m.icon, href: m.path! })),
    { id: 'settings', title: 'Ayarlar', icon: Settings, href: '/panel/ayarlar' },
  ]

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 hidden justify-center md:flex">
        <FloatingDock items={desktop} className="pointer-events-auto" />
      </div>

      <nav
        aria-label="Hızlı erişim"
        className="fixed inset-x-3 bottom-3 z-40 flex items-center justify-around rounded-2xl border border-border/70 bg-background/80 px-1 py-1.5 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.8)] backdrop-blur-xl md:hidden"
      >
        {mobile.map((m) => {
          const active =
            m.id === 'settings' ? pathname.startsWith('/panel/ayarlar') : here.item?.id === m.id || here.parent?.id === m.id
          return (
            <Link
              key={m.id}
              to={m.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10.5px]',
                active ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              {active && <span className="absolute inset-0 -z-10 rounded-xl bg-primary/10" />}
              <m.icon className="size-5" strokeWidth={1.7} />
              <span className="max-w-full truncate">{m.title}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
