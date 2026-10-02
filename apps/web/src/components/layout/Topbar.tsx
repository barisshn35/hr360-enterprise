import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, LogOut, Menu, Moon, Search, Sun, UserCog } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { NotificationBell } from '@/features/notification/NotificationBell'
import { useAuth } from '@/auth/useAuth'
import { primaryRole, roleLabels } from '@/auth/roles'
import { useTheme } from '@/lib/theme'
import { navGroups } from './SidebarNav'

/** Üst çubuktaki kırıntı izi: bölüm › üst modül › sayfa. */
export function crumbsForPath(pathname: string): string[] {
  if (pathname === '/panel' || pathname === '/panel/') return ['Genel bakış']
  if (pathname.startsWith('/panel/ayarlar')) return ['Ayarlar']
  let best = ''
  let crumbs: string[] = ['HR360']
  for (const group of navGroups) {
    for (const item of group.items) {
      for (const node of [item, ...(item.children ?? [])]) {
        if (node.path && pathname.startsWith(node.path) && node.path.length > best.length) {
          best = node.path
          crumbs = [group.heading, node === item ? undefined : item.title, node.title].filter(
            (c): c is string => Boolean(c),
          )
        }
      }
    }
  }
  return crumbs
}

export function Topbar({
  onOpenMobileNav,
  onOpenCommandPalette,
}: {
  onOpenMobileNav: () => void
  onOpenCommandPalette: () => void
}) {
  const { user, roles, logout, accountUrl } = useAuth()
  const { isDark, toggle } = useTheme()
  const location = useLocation()
  const crumbs = crumbsForPath(location.pathname)

  return (
    <header className="surface-glass sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3 sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Menüyü aç"
        onClick={onOpenMobileNav}
      >
        <Menu className="size-5" strokeWidth={1.75} />
      </Button>

      <nav aria-label="Konum" className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {crumbs.slice(0, -1).map((c) => (
          <span key={c} className="hidden shrink-0 items-center gap-1.5 text-muted-foreground md:flex">
            {c}
            <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground/50" />
          </span>
        ))}
        <h1 className="truncate font-medium text-foreground">{crumbs[crumbs.length - 1]}</h1>
      </nav>

      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="mr-1 hidden h-9 w-64 cursor-pointer whitespace-nowrap items-center gap-2 rounded-lg border border-border bg-card/50 px-2.5 text-[13px] text-muted-foreground shadow-[inset_0_1px_0_0_hsl(var(--edge-light))] transition-colors hover:border-primary/30 hover:text-foreground md:flex"
        >
          <Search className="size-4" strokeWidth={1.5} />
          <span className="flex-1 truncate text-left">Ara…</span>
          <kbd className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Ara"
          onClick={onOpenCommandPalette}
        >
          <Search className="size-[18px]" strokeWidth={1.75} />
        </Button>

        <NotificationBell />

        <Button
          variant="ghost"
          size="icon"
          aria-label={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
          onClick={toggle}
        >
          {isDark ? (
            <Sun className="size-[18px]" strokeWidth={1.75} />
          ) : (
            <Moon className="size-[18px]" strokeWidth={1.75} />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Hesap menüsü"
              className="ml-1 cursor-pointer rounded-full ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Avatar className="size-8 ring-1 ring-primary/25">
                <AvatarFallback className="bg-gradient-to-br from-primary/30 to-primary/5 text-[11.5px] font-semibold text-primary">
                  {user?.initials ?? 'HR'}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-[13px] font-semibold">
                {user?.fullName ?? 'Kullanıcı'}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                {user?.email ?? user?.username}
              </span>
              <span className="mt-1.5 inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {roleLabels[primaryRole(roles)]}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/panel/ayarlar">
                <UserCog className="size-4" strokeWidth={1.5} />
                Ayarlar
              </Link>
            </DropdownMenuItem>
            {accountUrl !== '#' && (
              <DropdownMenuItem asChild>
                <a href={accountUrl} target="_blank" rel="noreferrer">
                  <UserCog className="size-4" strokeWidth={1.5} />
                  Keycloak hesabım
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout()}>
              <LogOut className="size-4" strokeWidth={1.5} />
              Oturumu kapat
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
