/**
 * Staffware kenar çubuğu navigasyonu.
 *
 * Kaynak: 21st.dev "Dashboard Sidebar" (arunjdass) — çok katmanlı katlanabilir
 * navigasyon, workspace switcher ve komut paleti kancası hazır geliyordu.
 *
 * Staffware uyarlamaları:
 *  - WorkspaceSwitcher → TenantSwitcher: çok kiracılı mimaride kullanıcının
 *    bağlı olduğu şirketi gösterir. platform-admin ise tenant'lar arasında
 *    geçiş yapabilir; normal kullanıcı yalnızca kendi şirketini görür.
 *  - Sabit mock navigasyon → rol bazlı filtrelenen gerçek modül ağacı.
 *  - onSelect(id) → react-router navigasyonu.
 */

import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, LayoutDashboard, Inbox, CalendarDays, Wallet, LifeBuoy, Clock,
  Building2, Users, UserPlus, ClipboardCheck, Laptop, Target, GraduationCap,
  BadgeDollarSign, FileText, Bell, Settings, LogOut, ChevronDown, ChevronRight,
  Shield, UsersRound, UserRound, Crosshair, ClipboardList, Gauge, LineChart, MessageSquareText,
  Lightbulb, CalendarRange, Ruler, SlidersHorizontal, CalendarClock, Key,
} from 'lucide-react';
import type { Permission, Role } from '@/auth/roles';
import { hasStandardRole } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';

export type NavItemData = {
  id: string;
  title: string;
  icon: React.ElementType;
  path?: string;
  badge?: number | string;
  shortcut?: string;
  permission?: Permission;
  /** permission yerine/yanında: sadece bu sabit rollerden biri varsa göster
   * (Ek İzin - ext-* - sayılmaz). Bkz. roller öğesindeki kullanım notu. */
  requireRoles?: Role[];
  children?: NavItemData[];
};

export type NavGroupData = {
  heading?: string;
  items: NavItemData[];
};

/**
 * Modül ağacı. `permission` alanı olan girdiler, kullanıcının o izni
 * yoksa hiç render edilmez (bkz. filterByPermission).
 */
export const navGroups: NavGroupData[] = [
  {
    items: [
      { id: 'search', title: 'Ara', icon: Search, shortcut: '⌘K' },
      { id: 'overview', title: 'Genel bakış', icon: LayoutDashboard, path: '/panel' },
    ],
  },
  {
    heading: 'Günlük iş',
    items: [
      { id: 'approvals', title: 'Onay kutusu', icon: Inbox, path: '/panel/onaylar', permission: 'workflow:view' },
      { id: 'leave', title: 'İzin', icon: CalendarDays, path: '/panel/izin', permission: 'leave:view' },
      { id: 'expense', title: 'Masraf', icon: Wallet, path: '/panel/masraf', permission: 'expense:view' },
      { id: 'cases', title: 'İK vakaları', icon: LifeBuoy, path: '/panel/ik-vakalari', permission: 'case:view' },
      { id: 'timeshift', title: 'Puantaj', icon: Clock, path: '/panel/puantaj', permission: 'timeshift:view' },
      { id: 'shift-engine', title: 'Vardiya planı', icon: CalendarClock, path: '/panel/vardiya-motoru', permission: 'timeshift:view' },
    ],
  },
  {
    heading: 'Kişiler',
    items: [
      { id: 'organization', title: 'Organizasyon', icon: Building2, path: '/panel/organizasyon', permission: 'organization:view' },
      { id: 'employees', title: 'Çalışanlar', icon: Users, path: '/panel/calisanlar', permission: 'employee:viewAll' },
      { id: 'teams', title: 'Ekipler', icon: UsersRound, path: '/panel/organizasyon/ekipler', permission: 'organization:view' },
      {
        id: 'recruitment', title: 'İşe alım', icon: UserPlus, permission: 'recruitment:view',
        children: [
          { id: 'postings', title: 'İlanlar', icon: FileText, path: '/panel/ise-alim' },
          { id: 'candidates', title: 'Adaylar', icon: Users, path: '/panel/ise-alim/adaylar' },
        ],
      },
      {
        id: 'onboarding', title: 'Onboarding', icon: ClipboardCheck, permission: 'onboarding:view',
        children: [
          { id: 'plans', title: 'Planlar', icon: ClipboardCheck, path: '/panel/onboarding' },
          { id: 'assets', title: 'Zimmet', icon: Laptop, path: '/panel/zimmet' },
        ],
      },
    ],
  },
  {
    heading: 'Gelişim',
    items: [
      {
        id: 'performance', title: 'Performans', icon: Target, permission: 'performance:view',
        children: [
          { id: 'perf-me', title: 'Benim performansım', icon: UserRound, path: '/panel/performans/benim' },
          { id: 'perf-goals', title: 'Hedefler', icon: Crosshair, path: '/panel/performans/hedefler' },
          { id: 'perf-reviews', title: 'Değerlendirmeler', icon: ClipboardList, path: '/panel/performans/degerlendirme' },
          { id: 'perf-score', title: 'Puan dökümü', icon: Gauge, path: '/panel/performans/puan' },
          { id: 'perf-feedback', title: 'Geri bildirim', icon: MessageSquareText, path: '/panel/performans/geri-bildirim' },
          { id: 'perf-analytics', title: 'Analiz', icon: LineChart, path: '/panel/performans/analiz', permission: 'performance:manage' },
          { id: 'perf-recs', title: 'Aksiyon önerileri', icon: Lightbulb, path: '/panel/performans/oneriler', permission: 'performance:manage' },
        ],
      },
      {
        id: 'performance-setup', title: 'Performans kurulumu', icon: SlidersHorizontal, permission: 'performance:manage',
        children: [
          { id: 'perf-cycles', title: 'Dönemler', icon: CalendarRange, path: '/panel/performans/donemler' },
          { id: 'perf-metrics', title: 'Metrikler', icon: Ruler, path: '/panel/performans/metrikler' },
          { id: 'perf-settings', title: 'Puanlama ayarı', icon: SlidersHorizontal, path: '/panel/performans/ayarlar' },
        ],
      },
      { id: 'learning', title: 'Eğitim', icon: GraduationCap, path: '/panel/egitim', permission: 'learning:view' },
    ],
  },
  {
    heading: 'Yönetim',
    items: [
      {
        id: 'roles', title: 'Roller', icon: Key, path: '/panel/roller',
        permission: 'employee:manage',
        // Bkz. App.tsx'teki "roller" route notu: bu sayfanın veri uçları
        // tenant-service'in KENDİ RequireHrAdmin'ini kullanıyor (bilerek
        // "ext-*" ile genişletilmedi) - employee:manage Ek İznini alan
        // biri menüde bunu görüp tıklasa, sayfa "veriler alınamadı"
        // hatası verirdi. requireRoles, menüyü de backend'in gerçekte
        // kabul ettiği sabit rollerle eşleştiriyor.
        requireRoles: ['hr-admin', 'tenant-admin', 'platform-admin'],
      },
      { id: 'compensation', title: 'Ücret', icon: BadgeDollarSign, path: '/panel/ucret', permission: 'compensation:view' },
      { id: 'documents', title: 'Dokümanlar', icon: FileText, path: '/panel/dokumanlar', permission: 'document:manage' },
      { id: 'notifications', title: 'Bildirimler', icon: Bell, path: '/panel/bildirimler', permission: 'notification:view' },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { id: 'tenants', title: 'Kiracılar', icon: Shield, path: '/panel/platform/kiracilar', permission: 'platform:manage' },
    ],
  },
];

const bottomItems: NavItemData[] = [
  { id: 'settings', title: 'Ayarlar', icon: Settings, path: '/panel/ayarlar' },
  { id: 'logout', title: 'Oturumu kapat', icon: LogOut },
];

/** İzni olmayan girdileri (ve boş kalan grupları) ağaçtan çıkarır. */
function filterByPermission(
  groups: NavGroupData[],
  can: (p: Permission) => boolean,
  roles: string[],
): NavGroupData[] {
  const allowed = (item: NavItemData) =>
    (!item.permission || can(item.permission)) &&
    (!item.requireRoles || hasStandardRole(roles, item.requireRoles));
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter(allowed)
        .map((item) => (item.children ? { ...item, children: item.children.filter(allowed) } : item))
        .filter((item) => !item.children || item.children.length > 0),
    }))
    .filter((group) => group.items.length > 0);
}

function TenantSwitcher() {
  const { tenant, canSwitchTenant, availableTenants, switchTenant } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const name = tenant?.name ?? 'Staffware';
  const planLabel = tenant?.plan ? planLabels[tenant.plan] : '—';

  return (
    <div className="relative">
      <div
        onClick={() => canSwitchTenant && setIsOpen(!isOpen)}
        className={`flex items-center justify-between px-2 py-2 mb-4 rounded-lg transition-colors select-none group ${
          canSwitchTenant ? 'hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer' : ''
        }`}
      >
        <div className="flex items-center gap-3">
          {tenant?.logoUrl ? (
            <img
              src={tenant.logoUrl}
              alt={name}
              className="h-9 max-w-[64px] w-auto rounded-md object-contain shrink-0 bg-primary/10"
            />
          ) : (
            <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-semibold text-[13px] shadow-sm shrink-0">
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex flex-col overflow-hidden">
            <span className="text-[13px] font-medium leading-none mb-1 text-foreground truncate max-w-[130px]">
              {name}
            </span>
            <span className="text-[11px] text-muted-foreground leading-none">{planLabel}</span>
          </div>
        </div>
        {canSwitchTenant && (
          <ChevronDown
            className="w-4 h-4 text-muted-foreground/50 group-hover:text-foreground/70 transition-colors shrink-0"
            strokeWidth={1.5}
          />
        )}
      </div>

      {isOpen && canSwitchTenant && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-[52px] left-0 w-full bg-popover border border-border rounded-lg shadow-xl z-50 py-1 flex flex-col gap-0.5 max-h-72 overflow-y-auto no-scrollbar">
            <span className="px-3 pt-1 pb-2 text-[10px] font-semibold tracking-wider text-muted-foreground/60 uppercase">
              Kiracı seç
            </span>
            {availableTenants.map((t) => (
              <div
                key={t.slug}
                onClick={() => {
                  switchTenant(t.slug);
                  setIsOpen(false);
                }}
                className={`px-3 py-2 mx-1 text-[13px] rounded-md cursor-pointer transition-colors ${
                  tenant?.slug === t.slug
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-foreground/80 hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                {t.name}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const planLabels: Record<string, string> = {
  Trial: 'Deneme',
  Standard: 'Standart',
  Enterprise: 'Kurumsal',
};

function NavItem({
  item,
  activePath,
  onNavigate,
  level = 0,
}: {
  item: NavItemData;
  activePath: string;
  onNavigate: (item: NavItemData) => void;
  level?: number;
}) {
  const hasChildren = !!item.children?.length;
  // Alt girdiler kendi alt sayfalarında da etkin görünür (ör. /degerlendirme/{id}).
  const matches = (path: string | undefined, nested: boolean) =>
    !!path && (activePath === path || (nested && activePath.startsWith(path + '/')));
  const isActive = item.path
    ? matches(item.path, level > 0)
    : hasChildren && item.children!.some((c) => matches(c.path, true));
  const [isOpen, setIsOpen] = useState(isActive);

  const handleClick = () => {
    if (hasChildren) setIsOpen(!isOpen);
    else onNavigate(item);
  };

  return (
    <div className="flex flex-col w-full">
      <div
        className={`group flex items-center justify-between px-2.5 py-[7px] rounded-md cursor-pointer transition-all duration-200 select-none ${
          isActive && item.path
            ? 'bg-black/5 dark:bg-white/10 text-foreground font-medium'
            : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground/90'
        }`}
        style={{ paddingLeft: `${level * 12 + 10}px` }}
        onClick={handleClick}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <item.icon
            className={`w-4 h-4 shrink-0 transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground/70 group-hover:text-foreground/70'
            }`}
            strokeWidth={1.5}
          />
          <span className="text-[13px] tracking-wide truncate">{item.title}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.shortcut && (
            <kbd className="hidden group-hover:inline-flex items-center justify-center h-5 px-1.5 text-[10px] font-medium font-mono text-muted-foreground/60 bg-background/50 border border-border rounded">
              {item.shortcut}
            </kbd>
          )}
          {item.badge !== undefined && item.badge !== 0 && (
            <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary tabular">
              {item.badge}
            </span>
          )}
          {hasChildren && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
              strokeWidth={2}
            />
          )}
        </div>
      </div>

      {hasChildren && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-in-out ${
            isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden min-h-0 relative flex flex-col gap-0.5 mt-0.5">
            <div
              className="absolute top-0 bottom-0 border-l border-black/5 dark:border-white/5"
              style={{ left: `${level * 12 + 17.5}px` }}
            />
            {item.children!.map((child) => (
              <NavItem
                key={child.id}
                item={child}
                activePath={activePath}
                onNavigate={onNavigate}
                level={level + 1}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function SidebarNav({
  className = '',
  onOpenCommandPalette,
  unreadCount = 0,
}: {
  className?: string;
  onOpenCommandPalette: () => void;
  unreadCount?: number;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, roles, logout } = useAuth();

  const groups = useMemo(() => {
    const filtered = filterByPermission(navGroups, can, roles);
    // Okunmamış bildirim sayısını rozet olarak bas.
    return filtered.map((g) => ({
      ...g,
      items: g.items.map((i) =>
        i.id === 'notifications' ? { ...i, badge: unreadCount } : i,
      ),
    }));
  }, [can, roles, unreadCount]);

  const handleNavigate = (item: NavItemData) => {
    if (item.id === 'search') return onOpenCommandPalette();
    if (item.id === 'logout') return logout();
    if (item.path) navigate(item.path);
  };

  return (
    <div
      className={`flex flex-col w-[260px] h-full bg-sidebar border-r border-sidebar-border p-3 ${className}`}
    >
      <TenantSwitcher />

      <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col gap-4 mt-2">
        {groups.map((group, idx) => (
          <div key={idx} className="flex flex-col gap-0.5">
            {group.heading && (
              <span className="px-2.5 mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/50 uppercase">
                {group.heading}
              </span>
            )}
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                activePath={location.pathname}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4 border-t border-sidebar-border flex flex-col gap-0.5">
        {bottomItems.map((item) => (
          <NavItem
            key={item.id}
            item={item}
            activePath={location.pathname}
            onNavigate={handleNavigate}
          />
        ))}
      </div>
    </div>
  );
}
