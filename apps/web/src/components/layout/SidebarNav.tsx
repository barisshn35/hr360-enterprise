/**
 * HR360 kenar çubuğu navigasyonu.
 *
 * Kaynak: 21st.dev "Sidebar" (wensity, id 31454) — ikon rayına daralan
 * kenar çubuğu, bölüm başlıkları, rozetler, kullanıcı alt bilgisi ve
 * öğeler arasında kayan etkin "hap" (motion layoutId). Önceki sürümdeki
 * 21st.dev "Dashboard Sidebar" (arunjdass) yapısının yerine geçti.
 *
 * HR360 uyarlamaları:
 *  - WorkspaceSwitcher → TenantSwitcher: kullanıcının bağlı olduğu şirket;
 *    platform yöneticisi kiracılar arasında geçiş yapabilir.
 *  - Sabit demo navigasyonu → rol/izin bazlı filtrelenen gerçek modül ağacı.
 *  - Etkin öğe zümrüt tonda; solunda parlayan gösterge çizgisi.
 *  - Daraltılmış hâl tarayıcıda saklanır (lib/sidebar.ts); rayda alt menülü
 *    bir girdiye tıklamak çubuğu açar ve o grubu genişletir.
 *  - Oturumu kapatma, menü listesinden kullanıcı kartına taşındı.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  LayoutDashboard, Inbox, CalendarDays, Wallet, LifeBuoy, Clock,
  Building2, Users, UserPlus, ClipboardCheck, Laptop, Target, GraduationCap,
  BadgeDollarSign, FileText, Bell, Settings, LogOut, ChevronsUpDown, ChevronRight,
  Shield, UsersRound, UserRound, Crosshair, ClipboardList, Gauge, LineChart, MessageSquareText,
  Lightbulb, CalendarRange, Ruler, SlidersHorizontal, CalendarClock, Key, Check,
  PanelLeftClose,
} from 'lucide-react';
import type { Permission, Role } from '@/auth/roles';
import { hasStandardRole, primaryRole, roleLabels } from '@/auth/roles';
import { useAuth } from '@/auth/useAuth';
import { useSidebarCollapsed, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '@/lib/sidebar';
import { cn } from '@/lib/utils';

export type NavItemData = {
  id: string;
  title: string;
  icon: React.ElementType;
  path?: string;
  badge?: number | string;
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

/**
 * İzni olmayan girdileri (ve boş kalan grupları) ağaçtan çıkarır. Komut
 * paleti de aynı filtreyi kullanır; menüde olmayan bir modül orada da çıkmaz.
 */
export function filterByPermission(
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

const planLabels: Record<string, string> = {
  Trial: 'Deneme',
  Standard: 'Standart',
  Enterprise: 'Kurumsal',
};

const EASE_OUT = [0.23, 1, 0.32, 1] as const;

/* ------------------------------------------------------------------------- */

function FadingLabel({ show, className, children }: { show: boolean; className?: string; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.12, ease: EASE_OUT }}
          className={className}
        >
          {children}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function TenantSwitcher({ collapsed }: { collapsed: boolean }) {
  const { tenant, canSwitchTenant, availableTenants, switchTenant } = useAuth();
  const [isOpen, setIsOpen] = useState(false);

  const name = tenant?.name ?? 'HR360';
  const planLabel = tenant?.plan ? planLabels[tenant.plan] : 'Platform';

  const mark = tenant?.logoUrl ? (
    <img
      src={tenant.logoUrl}
      alt={name}
      className="size-9 shrink-0 rounded-lg bg-white/90 object-contain p-1 ring-1 ring-border"
    />
  ) : (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-[14px] font-semibold text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.25),0_6px_18px_-6px_hsl(var(--primary)/0.7)]">
      {name.charAt(0).toUpperCase()}
    </span>
  );

  return (
    <div className="relative">
      <button
        type="button"
        disabled={!canSwitchTenant}
        onClick={() => setIsOpen((v) => !v)}
        title={collapsed ? name : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors select-none',
          canSwitchTenant ? 'cursor-pointer hover:bg-sidebar-accent' : 'cursor-default',
          collapsed && 'justify-center',
        )}
      >
        {mark}
        {!collapsed && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13.5px] leading-tight font-semibold">{name}</span>
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[10.5px] leading-tight font-medium text-primary">
                {planLabel}
              </span>
            </span>
            {canSwitchTenant && (
              <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            )}
          </>
        )}
      </button>

      {isOpen && canSwitchTenant && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className={cn(
              'no-scrollbar absolute top-[52px] z-50 flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-popover',
              collapsed ? 'left-0 w-56' : 'left-0 w-full',
            )}
          >
            <span className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Kiracı seç
            </span>
            {availableTenants.map((t) => (
              <button
                type="button"
                key={t.slug}
                onClick={() => {
                  switchTenant(t.slug);
                  setIsOpen(false);
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  tenant?.slug === t.slug
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground/80 hover:bg-accent',
                )}
              >
                <span className="truncate">{t.name}</span>
                {tenant?.slug === t.slug && <Check className="size-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Etkin öğenin zemini: öğeler arasında yay animasyonuyla kayar. */
function ActivePill({ layoutGroup }: { layoutGroup: string }) {
  const reduced = useReducedMotion();
  const cls =
    'pointer-events-none absolute inset-0 rounded-lg bg-primary/[0.09] ring-1 ring-inset ring-primary/15 shadow-[inset_0_1px_0_0_hsl(var(--edge-light))]';
  const bar = (
    <span className="absolute top-1/2 -left-2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_12px_2px_hsl(var(--primary)/0.55)]" />
  );
  if (reduced)
    return (
      <span aria-hidden="true" className={cls}>
        {bar}
      </span>
    );
  return (
    <motion.span
      aria-hidden="true"
      layoutId={`${layoutGroup}-active`}
      transition={{ type: 'spring', stiffness: 520, damping: 42 }}
      className={cls}
    >
      {bar}
    </motion.span>
  );
}

function NavItem({
  item,
  activePath,
  onNavigate,
  collapsed,
  layoutGroup,
  onExpand,
  level = 0,
}: {
  item: NavItemData;
  activePath: string;
  onNavigate: (item: NavItemData) => void;
  collapsed: boolean;
  layoutGroup: string;
  onExpand: () => void;
  level?: number;
}) {
  const reduced = useReducedMotion();
  const hasChildren = !!item.children?.length;
  // Alt girdiler kendi alt sayfalarında da etkin görünür (ör. /degerlendirme/{id}).
  const matches = (path: string | undefined, nested: boolean) =>
    !!path && (activePath === path || (nested && activePath.startsWith(path + '/')));
  const selfActive = !!item.path && matches(item.path, level > 0);
  const childActive = hasChildren && item.children!.some((c) => matches(c.path, true));
  const [isOpen, setIsOpen] = useState(childActive);

  // Başka yoldan (komut paleti, bağlantı) bir alt sayfaya gelinince grup açılsın.
  useEffect(() => {
    if (childActive) setIsOpen(true);
  }, [childActive]);

  const handleClick = () => {
    if (hasChildren) {
      if (collapsed) {
        onExpand();
        setIsOpen(true);
      } else setIsOpen(!isOpen);
    } else onNavigate(item);
  };

  // Rayda alt menüsü olan bir grubun alt sayfası açıksa grup ikonu etkin görünür.
  const showPill = selfActive || (collapsed && childActive);

  return (
    <div className="flex w-full flex-col">
      <button
        type="button"
        onClick={handleClick}
        title={collapsed ? item.title : undefined}
        aria-current={selfActive ? 'page' : undefined}
        aria-expanded={hasChildren ? isOpen && !collapsed : undefined}
        className={cn(
          'group/item relative flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-[7px] text-left outline-none select-none',
          'transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-primary/40',
          collapsed ? 'justify-center px-0' : 'px-2.5',
          showPill
            ? 'text-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
          level > 0 && 'py-1.5',
        )}
      >
        {showPill && <ActivePill layoutGroup={layoutGroup} />}
        <item.icon
          className={cn(
            'relative z-10 shrink-0 transition-colors',
            level > 0 ? 'size-[15px]' : 'size-[17px]',
            showPill ? 'text-primary' : 'text-muted-foreground/80 group-hover/item:text-foreground',
            !showPill && childActive && 'text-primary/80',
          )}
          strokeWidth={1.6}
        />
        <FadingLabel show={!collapsed} className="relative z-10 min-w-0 flex-1 truncate text-[13.5px] leading-tight">
          {item.title}
        </FadingLabel>
        {!collapsed && item.badge !== undefined && item.badge !== 0 && (
          <span className="tabular relative z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-primary-foreground shadow-[0_0_12px_-2px_hsl(var(--primary)/0.8)]">
            {item.badge}
          </span>
        )}
        {collapsed && item.badge !== undefined && item.badge !== 0 && (
          <span className="absolute top-1 right-3 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
        )}
        {!collapsed && hasChildren && (
          <motion.span
            aria-hidden="true"
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: EASE_OUT }}
            className="relative z-10 flex items-center text-muted-foreground/60"
          >
            <ChevronRight className="size-3.5" strokeWidth={2} />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {hasChildren && isOpen && !collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: reduced ? 0 : 0.24, ease: EASE_OUT },
              opacity: { duration: reduced ? 0 : 0.16, ease: EASE_OUT },
            }}
            className="overflow-hidden"
          >
            <div className="relative ml-[19px] flex flex-col gap-px py-0.5 pl-2.5 before:absolute before:inset-y-1 before:left-0 before:w-px before:bg-border">
              {item.children!.map((child) => (
                <NavItem
                  key={child.id}
                  item={child}
                  activePath={activePath}
                  onNavigate={onNavigate}
                  collapsed={collapsed}
                  layoutGroup={layoutGroup}
                  onExpand={onExpand}
                  level={level + 1}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserCard({ collapsed, settingsActive }: { collapsed: boolean; settingsActive: boolean }) {
  const { user, roles, logout } = useAuth();
  const navigate = useNavigate();
  const initials = user?.initials ?? 'HR';
  const avatar = (
    <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/5 text-[11.5px] font-semibold text-primary ring-1 ring-primary/25">
      {initials}
      <span className="absolute -right-px -bottom-px size-2.5 rounded-full bg-[hsl(var(--success))] ring-2 ring-sidebar" />
    </span>
  );
  const iconBtn =
    'flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors';
  if (collapsed)
    return (
      <button
        type="button"
        onClick={() => navigate('/panel/ayarlar')}
        title={`${user?.fullName ?? 'Kullanıcı'} — Ayarlar`}
        aria-label="Ayarlar"
        className={cn(
          'mx-auto flex cursor-pointer rounded-full transition-opacity hover:opacity-80',
          settingsActive && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-sidebar',
        )}
      >
        {avatar}
      </button>
    );
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-accent/60 p-2 shadow-[inset_0_1px_0_0_hsl(var(--edge-light))]">
      {avatar}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] leading-tight font-medium">{user?.fullName ?? 'Kullanıcı'}</p>
        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground">
          {roleLabels[primaryRole(roles)]}
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate('/panel/ayarlar')}
        aria-label="Ayarlar"
        title="Ayarlar"
        aria-current={settingsActive ? 'page' : undefined}
        className={cn(
          iconBtn,
          settingsActive ? 'bg-primary/10 text-primary' : 'hover:bg-accent hover:text-foreground',
        )}
      >
        <Settings className="size-4" strokeWidth={1.6} />
      </button>
      <button
        type="button"
        onClick={() => logout()}
        aria-label="Oturumu kapat"
        title="Oturumu kapat"
        className={cn(iconBtn, 'hover:bg-destructive/10 hover:text-destructive')}
      >
        <LogOut className="size-4" strokeWidth={1.6} />
      </button>
    </div>
  );
}

export function SidebarNav({
  className = '',
  unreadCount = 0,
  /** Mobil çekmecede her zaman tam genişlik; daraltma düğmesi gizlenir. */
  mobile = false,
}: {
  className?: string;
  unreadCount?: number;
  mobile?: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, roles } = useAuth();
  const { collapsed: storedCollapsed, setCollapsed, toggle } = useSidebarCollapsed();
  const collapsed = mobile ? false : storedCollapsed;
  const layoutGroup = mobile ? 'sidebar-mobile' : 'sidebar';

  const groups = useMemo(() => {
    const filtered = filterByPermission(navGroups, can, roles);
    // Okunmamış bildirim sayısını rozet olarak bas.
    return filtered.map((g) => ({
      ...g,
      items: g.items.map((i) => (i.id === 'notifications' ? { ...i, badge: unreadCount } : i)),
    }));
  }, [can, roles, unreadCount]);

  const handleNavigate = (item: NavItemData) => {
    if (item.path) navigate(item.path);
  };

  return (
    <nav
      aria-label="Modüller"
      style={{ width: mobile ? '100%' : collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH }}
      className={cn(
        'relative flex h-full flex-col border-r border-sidebar-border bg-sidebar',
        'transition-[width] duration-[240ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        className,
      )}
    >
      {/* Üstten süzülen zümrüt ışık */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-primary/[0.07] to-transparent"
      />

      <div
        className={cn(
          'relative flex gap-1.5 pt-3',
          collapsed ? 'flex-col items-center px-2.5' : 'items-center px-3',
        )}
      >
        <div className={cn('min-w-0', !collapsed && 'flex-1')}>
          <TenantSwitcher collapsed={collapsed} />
        </div>
        {!mobile && (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            title={collapsed ? 'Menüyü genişlet' : 'Menüyü daralt'}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose
              className={cn('size-[17px] transition-transform duration-300', collapsed && 'rotate-180')}
              strokeWidth={1.6}
            />
          </button>
        )}

      </div>

      <div
        className={cn(
          'no-scrollbar relative mt-3 flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto pb-3',
          collapsed ? 'px-2.5' : 'px-3',
        )}
      >
        {groups.map((group, idx) => (
          <div key={idx} className="flex flex-col gap-px">
            {group.heading &&
              (collapsed ? (
                <span aria-hidden="true" className="mx-auto mb-1.5 h-px w-6 bg-sidebar-border" />
              ) : (
                <span className="px-2.5 pb-1.5 text-[10.5px] font-medium tracking-[0.1em] text-muted-foreground/70 uppercase">
                  {group.heading}
                </span>
              ))}
            {group.items.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                activePath={location.pathname}
                onNavigate={handleNavigate}
                collapsed={collapsed}
                layoutGroup={layoutGroup}
                onExpand={() => setCollapsed(false)}
              />
            ))}
          </div>
        ))}
      </div>

      <div
        className={cn(
          'relative border-t border-sidebar-border py-3',
          collapsed ? 'px-2.5' : 'px-3',
        )}
      >
        <UserCard collapsed={collapsed} settingsActive={location.pathname.startsWith('/panel/ayarlar')} />
      </div>
    </nav>
  );
}
