import { Link, useLocation } from 'react-router-dom'
import { LogOut, Menu, Moon, Search, Sun, UserCog } from 'lucide-react'
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

/** Adres çubuğundaki yolu modül başlığına çevirir — her sayfada tekrar yazmayalım. */
export function titleForPath(pathname: string): string {
  if (pathname === '/panel' || pathname === '/panel/') return 'Genel bakış'
  let best = ''
  let title = 'Staffware'
  for (const group of navGroups) {
    for (const item of group.items) {
      for (const node of [item, ...(item.children ?? [])]) {
        if (node.path && pathname.startsWith(node.path) && node.path.length > best.length) {
          best = node.path
          title = node.title
        }
      }
    }
  }
  if (!best && pathname.startsWith('/panel/ayarlar')) return 'Ayarlar'
  return title
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

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/85 px-3 backdrop-blur sm:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Menüyü aç"
        onClick={onOpenMobileNav}
      >
        <Menu className="size-5" strokeWidth={1.75} />
      </Button>

      <h1 className="truncate text-[15px] font-semibold">{titleForPath(location.pathname)}</h1>

      <div className="ml-auto flex items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="hidden h-9 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:flex"
        >
          <Search className="size-4" strokeWidth={1.5} />
          <span>Ara</span>
          <kbd className="ml-2 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]">
            ⌘K
          </kbd>
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
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
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary/10 text-[12px] font-semibold text-primary">
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
