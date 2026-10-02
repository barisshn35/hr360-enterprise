/**
 * Panelin modül ağacı — üst menü, mega menü, dock, mobil menü ve komut
 * paleti hepsi buradan beslenir. `permission`/`requireRoles` alanı olan
 * girdiler, kullanıcının yetkisi yoksa hiçbir yerde görünmez.
 */

import {
  LayoutDashboard, Inbox, CalendarDays, Wallet, LifeBuoy, Clock,
  Building2, Users, UserPlus, ClipboardCheck, Laptop, Target, GraduationCap,
  BadgeDollarSign, FileText, Bell, Shield, UsersRound, UserRound, Crosshair,
  ClipboardList, Gauge, LineChart, MessageSquareText, Lightbulb, CalendarRange,
  Ruler, SlidersHorizontal, CalendarClock, Key, Sparkles, Briefcase, Sprout,
  Settings2, Globe2, HeartHandshake, PartyPopper, MapPin, Handshake, Megaphone,
  MessagesSquare, HeartPulse, GitBranch, LogOut, ScrollText, ShieldCheck, FileStack,
  Workflow, PlugZap, Receipt, Radar, History, BarChart3, Bot, Calculator, FileSpreadsheet,
  Route, Telescope, Award, Search, Lock,
} from 'lucide-react'
import type { Permission, Role } from '@/auth/roles'
import { hasStandardRole } from '@/auth/roles'

export type NavItemData = {
  id: string
  title: string
  /** Mega menüde başlığın altındaki tek satır. */
  description?: string
  icon: React.ElementType
  path?: string
  badge?: number | string
  permission?: Permission
  /** Plan bazlı modül kısıtı: governance /plan yanıtındaki özellik anahtarı. */
  feature?: string
  /** permission yerine/yanında: sadece bu sabit rollerden biri varsa göster
   * (Ek İzin - ext-* - sayılmaz). Bkz. roller öğesindeki kullanım notu. */
  requireRoles?: Role[]
  children?: NavItemData[]
}

export type NavGroupData = {
  id: string
  heading: string
  /** Mega menünün sol tanıtım kutusundaki cümle. */
  tagline: string
  icon: React.ElementType
  items: NavItemData[]
}

export const overviewItem: NavItemData = {
  id: 'overview',
  title: 'Genel bakış',
  description: 'Bekleyen işler ve şirketin nabzı',
  icon: LayoutDashboard,
  path: '/panel',
}

export const navGroups: NavGroupData[] = [
  {
    id: 'daily',
    heading: 'Günlük iş',
    tagline: 'Talepler, onaylar ve zaman çizelgesi tek akışta.',
    icon: Sparkles,
    items: [
      { id: 'approvals', title: 'Onay kutusu', description: 'Kararınızı bekleyen talepler', icon: Inbox, path: '/panel/onaylar', permission: 'workflow:view' },
      { id: 'leave', title: 'İzin', description: 'Talepler ve yıllık bakiyeler', icon: CalendarDays, path: '/panel/izin', permission: 'leave:view' },
      { id: 'expense', title: 'Masraf', description: 'Fiş, harcama ve geri ödeme', icon: Wallet, path: '/panel/masraf', permission: 'expense:view' },
      { id: 'cases', title: 'İK vakaları', description: 'Soru, talep ve şikâyet defteri', icon: LifeBuoy, path: '/panel/ik-vakalari', permission: 'case:view' },
      { id: 'timeshift', title: 'Puantaj', description: 'Giriş/çıkış ve fazla mesai', icon: Clock, path: '/panel/puantaj', permission: 'timeshift:view' },
      { id: 'shift-engine', title: 'Vardiya planı', description: 'Döngüsel desenler, 7/24 kapsama', icon: CalendarClock, path: '/panel/vardiya-motoru', permission: 'timeshift:view' },
      { id: 'workplace', title: 'Ofis ve masa', description: 'Kim nerede, masa/oda rezervasyonu', icon: MapPin, path: '/panel/ofis', feature: 'workplace' },
      { id: 'payroll-sim', title: 'Bordro simülasyonu', description: 'Brütten nete, 2026 parametreleri', icon: Calculator, path: '/panel/bordro-simulasyonu', feature: 'payroll-sim' },
    ],
  },
  {
    id: 'people',
    heading: 'Kişiler',
    tagline: 'Organizasyon, ekipler ve işe alımdan ilk güne.',
    icon: Briefcase,
    items: [
      { id: 'organization', title: 'Organizasyon', description: 'Şirket ve departman hiyerarşisi', icon: Building2, path: '/panel/organizasyon', permission: 'organization:view' },
      { id: 'employees', title: 'Çalışanlar', description: 'Kayıtlar ve çalışma durumu', icon: Users, path: '/panel/calisanlar', permission: 'employee:viewAll' },
      { id: 'teams', title: 'Ekipler', description: 'Diyagram ve ekip yönetimi', icon: UsersRound, path: '/panel/organizasyon/ekipler', permission: 'organization:view' },
      {
        id: 'recruitment', title: 'İşe alım', description: 'İlanlar, adaylar, mülakatlar', icon: UserPlus, permission: 'recruitment:view',
        children: [
          { id: 'postings', title: 'İlanlar', description: 'Açık pozisyonlar', icon: FileText, path: '/panel/ise-alim' },
          { id: 'candidates', title: 'Adaylar', description: 'Aday havuzu', icon: Users, path: '/panel/ise-alim/adaylar' },
          { id: 'hire-saga', title: 'Teklif → işe giriş', description: 'İşe alım sagası izleme', icon: Route, path: '/panel/ise-alim/saga', feature: 'sagas', requireRoles: ['hr-admin', 'tenant-admin', 'platform-admin'] },
        ],
      },
      {
        id: 'onboarding', title: 'Onboarding', description: 'İşe giriş planları ve zimmet', icon: ClipboardCheck, permission: 'onboarding:view',
        children: [
          { id: 'plans', title: 'Planlar', description: 'İşe giriş görevleri', icon: ClipboardCheck, path: '/panel/onboarding' },
          { id: 'assets', title: 'Zimmet', description: 'Demirbaş ve atamalar', icon: Laptop, path: '/panel/zimmet' },
        ],
      },
      { id: 'offboarding', title: 'İşten ayrılış', description: 'Kontrol listesi, çıkış görüşmesi, hak ediş', icon: LogOut, path: '/panel/offboarding', permission: 'onboarding:manage', feature: 'offboarding' },
      { id: 'succession', title: 'Ardıl planlama', description: 'Kritik roller ve yedekler', icon: GitBranch, path: '/panel/ardil-planlama', permission: 'performance:manage', feature: 'succession' },
      { id: 'org-scenarios', title: 'Org senaryoları', description: '"Ya şöyle olsaydı?" planlama', icon: Workflow, path: '/panel/org-senaryolari', permission: 'performance:manage', feature: 'org-scenarios' },
    ],
  },
  {
    id: 'growth',
    heading: 'Gelişim',
    tagline: 'Hedefler, değerlendirmeler ve öğrenme yolculuğu.',
    icon: Sprout,
    items: [
      {
        id: 'performance', title: 'Performans', description: 'Hedef, değerlendirme, geri bildirim', icon: Target, permission: 'performance:view',
        children: [
          { id: 'perf-me', title: 'Benim performansım', description: 'Kişisel karne', icon: UserRound, path: '/panel/performans/benim' },
          { id: 'perf-goals', title: 'Hedefler', description: 'Dönem hedefleri', icon: Crosshair, path: '/panel/performans/hedefler' },
          { id: 'perf-reviews', title: 'Değerlendirmeler', description: 'Öz ve yönetici değerlendirmesi', icon: ClipboardList, path: '/panel/performans/degerlendirme' },
          { id: 'perf-score', title: 'Puan dökümü', description: 'Ağırlıklı puan hesabı', icon: Gauge, path: '/panel/performans/puan' },
          { id: 'perf-feedback', title: 'Geri bildirim', description: 'Sürekli geri bildirim', icon: MessageSquareText, path: '/panel/performans/geri-bildirim' },
          { id: 'perf-analytics', title: 'Analiz', description: 'Ekip gidişatı', icon: LineChart, path: '/panel/performans/analiz', permission: 'performance:manage' },
          { id: 'perf-recs', title: 'Aksiyon önerileri', description: 'Model önerileri', icon: Lightbulb, path: '/panel/performans/oneriler', permission: 'performance:manage' },
        ],
      },
      {
        id: 'performance-setup', title: 'Performans kurulumu', description: 'Dönem, metrik, puanlama', icon: SlidersHorizontal, permission: 'performance:manage',
        children: [
          { id: 'perf-cycles', title: 'Dönemler', description: 'Değerlendirme dönemleri', icon: CalendarRange, path: '/panel/performans/donemler' },
          { id: 'perf-metrics', title: 'Metrikler', description: 'Ölçülen göstergeler', icon: Ruler, path: '/panel/performans/metrikler' },
          { id: 'perf-settings', title: 'Puanlama ayarı', description: 'Ağırlık ve ölçek', icon: SlidersHorizontal, path: '/panel/performans/ayarlar' },
        ],
      },
      { id: 'learning', title: 'Eğitim', description: 'Katalog ve sertifikalar', icon: GraduationCap, path: '/panel/egitim', permission: 'learning:view' },
      { id: 'mentorship', title: 'Mentorluk', description: 'Beceri eşleştirmeli mentor bulma', icon: Handshake, path: '/panel/mentorluk', feature: 'mentorship' },
      { id: 'mobility', title: 'İç ilanlar', description: 'Şirket içi açık pozisyonlar', icon: Megaphone, path: '/panel/ic-ilanlar', feature: 'mobility' },
      { id: 'one-on-ones', title: '1:1 görüşmeler', description: 'Ortak gündem, aksiyonlar, notlar', icon: MessagesSquare, path: '/panel/birebir', feature: 'one-on-ones' },
      { id: 'team-health', title: 'Ekip sağlığı', description: 'Tükenmişlik sinyalleri', icon: HeartPulse, path: '/panel/ekip-sagligi', permission: 'performance:manage', feature: 'team-health' },
    ],
  },
  {
    id: 'community',
    heading: 'Topluluk',
    tagline: 'Takdir, kutlama ve nabız — şirket kültürü burada görünür.',
    icon: HeartHandshake,
    items: [
      { id: 'kudos', title: 'Takdir duvarı', description: 'Rozetli teşekkürler', icon: Award, path: '/panel/takdir', feature: 'kudos' },
      { id: 'celebrations', title: 'Kutlamalar', description: 'Doğum günü ve iş yıl dönümleri', icon: PartyPopper, path: '/panel/kutlamalar', feature: 'celebrations' },
      { id: 'surveys', title: 'Anketler ve eNPS', description: 'Anonim nabız anketleri', icon: MessagesSquare, path: '/panel/anketler', feature: 'surveys' },
      { id: 'directory', title: 'Yetenek dizini', description: 'Kim ne biliyor?', icon: Search, path: '/panel/yetenek-dizini', feature: 'profile' },
    ],
  },
  {
    id: 'insights',
    heading: 'İçgörü',
    tagline: 'Rakamlar, zaman yolculuğu ve yapay zekâ destekli araçlar.',
    icon: Telescope,
    items: [
      { id: 'analytics', title: 'Analitik', description: 'Kadro, devir, izin, mesai eğilimi', icon: BarChart3, path: '/panel/analitik', permission: 'performance:manage', feature: 'analytics' },
      { id: 'nl-report', title: 'Rapor asistanı', description: 'Türkçe sorun, tablo ve grafik gelsin', icon: Sparkles, path: '/panel/rapor-asistani', permission: 'performance:manage', feature: 'nl-report' },
      { id: 'time-machine', title: 'Zaman makinesi', description: 'Organizasyon geçmişte nasıldı?', icon: History, path: '/panel/zaman-makinesi', permission: 'performance:manage', feature: 'time-machine' },
      { id: 'event-radar', title: 'Canlı olay radarı', description: 'Kafka olayları gerçek zamanlı', icon: Radar, path: '/panel/olay-radari', permission: 'performance:manage', feature: 'events' },
      { id: 'ai-tools', title: 'Yapay zekâ araçları', description: 'CV, ilan, eşleşme, tahmin', icon: Bot, path: '/panel/ai-araclari', permission: 'recruitment:view', feature: 'ai-tools' },
    ],
  },
  {
    id: 'admin',
    heading: 'Yönetim',
    tagline: 'Roller, ücret yapısı, dokümanlar ve bildirimler.',
    icon: Settings2,
    items: [
      {
        id: 'roles', title: 'Roller', description: 'Yetkiler ve ek izinler', icon: Key, path: '/panel/roller',
        permission: 'employee:manage',
        // Bkz. App.tsx'teki "roller" route notu: bu sayfanın veri uçları
        // tenant-service'in KENDİ RequireHrAdmin'ini kullanıyor (bilerek
        // "ext-*" ile genişletilmedi) - employee:manage Ek İznini alan
        // biri menüde bunu görüp tıklasa, sayfa "veriler alınamadı"
        // hatası verirdi. requireRoles, menüyü de backend'in gerçekte
        // kabul ettiği sabit rollerle eşleştiriyor.
        requireRoles: ['hr-admin', 'tenant-admin', 'platform-admin'],
      },
      { id: 'compensation', title: 'Ücret', description: 'Bantlar, geçmiş, zam simülasyonu', icon: BadgeDollarSign, path: '/panel/ucret', permission: 'compensation:view' },
      { id: 'documents', title: 'Dokümanlar', description: 'Çalışan dosyaları', icon: FileText, path: '/panel/dokumanlar', permission: 'document:manage' },
      { id: 'notifications', title: 'Bildirimler', description: 'Gelen kutusu ve şablonlar', icon: Bell, path: '/panel/bildirimler', permission: 'notification:view' },
      { id: 'doc-templates', title: 'Belge şablonları', description: 'Toplu belge ve PDF üretimi', icon: FileStack, path: '/panel/belge-sablonlari', permission: 'document:manage', feature: 'documents' },
      { id: 'privacy', title: 'KVKK', description: 'Rıza, başvuru, saklama süresi', icon: ShieldCheck, path: '/panel/kvkk', permission: 'employee:manage', feature: 'privacy' },
      { id: 'audit', title: 'Denetim kaydı', description: 'Kim neyi ne zaman değiştirdi', icon: ScrollText, path: '/panel/denetim', permission: 'employee:manage', feature: 'audit' },
      { id: 'rules', title: 'Kural motoru', description: '"Olursa → yap" otomasyonları', icon: Workflow, path: '/panel/kural-motoru', permission: 'employee:manage', feature: 'rules' },
      { id: 'integrations', title: 'Entegrasyonlar', description: 'Webhook, API, Slack/Teams', icon: PlugZap, path: '/panel/entegrasyonlar', permission: 'employee:manage', feature: 'webhooks' },
      { id: 'security', title: 'Güvenlik', description: 'SSO ve iki adımlı doğrulama', icon: Lock, path: '/panel/guvenlik', permission: 'tenant:manage', requireRoles: ['tenant-admin', 'platform-admin'], feature: 'sso' },
      { id: 'import-export', title: 'İçe/dışa aktarım', description: 'Excel ile toplu veri', icon: FileSpreadsheet, path: '/panel/ice-disa-aktarim', permission: 'employee:manage', feature: 'import-export' },
      { id: 'billing', title: 'Abonelik', description: 'Plan, koltuk ve faturalar', icon: Receipt, path: '/panel/abonelik', permission: 'tenant:manage', feature: 'billing' },
    ],
  },
  {
    id: 'platform',
    heading: 'Platform',
    tagline: 'Kiracılar, planlar ve kotalar.',
    icon: Globe2,
    items: [
      { id: 'tenants', title: 'Kiracılar', description: 'Şirketler, plan ve kota', icon: Shield, path: '/panel/platform/kiracilar', permission: 'platform:manage' },
      { id: 'platform-invoices', title: 'Faturalar', description: 'Tüm kiracıların faturaları', icon: Receipt, path: '/panel/platform/faturalar', permission: 'platform:manage', feature: 'billing' },
    ],
  },
]

/** İzni olmayan girdileri (ve boş kalan grupları) ağaçtan çıkarır. */
export function filterByPermission(
  groups: NavGroupData[],
  can: (p: Permission) => boolean,
  roles: string[],
  hasFeature: (feature: string) => boolean = () => true,
): NavGroupData[] {
  const allowed = (item: NavItemData) =>
    (!item.permission || can(item.permission)) &&
    (!item.requireRoles || hasStandardRole(roles, item.requireRoles)) &&
    (!item.feature || hasFeature(item.feature))
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .filter(allowed)
        .map((item) => (item.children ? { ...item, children: item.children.filter(allowed) } : item))
        .filter((item) => !item.children || item.children.length > 0),
    }))
    .filter((group) => group.items.length > 0)
}

/** Ağaçtaki yola gidilebilir tüm girdiler (alt girdiler dâhil). */
export function flattenItems(groups: NavGroupData[]): Array<NavItemData & { group: NavGroupData; parent?: NavItemData }> {
  return groups.flatMap((group) =>
    group.items.flatMap((item) =>
      item.children
        ? item.children.map((child) => ({ ...child, group, parent: item }))
        : [{ ...item, group }],
    ),
  )
}

/** Adres çubuğundaki yolu menüdeki konuma çevirir (bölüm, üst modül, sayfa). */
export function locate(pathname: string): { group?: NavGroupData; parent?: NavItemData; item?: NavItemData } {
  if (pathname === '/panel' || pathname === '/panel/') return { item: overviewItem }
  let best: { group?: NavGroupData; parent?: NavItemData; item?: NavItemData } = {}
  let bestLen = 0
  for (const entry of flattenItems(navGroups)) {
    if (entry.path && pathname.startsWith(entry.path) && entry.path.length > bestLen) {
      bestLen = entry.path.length
      best = { group: entry.group, parent: entry.parent, item: entry }
    }
  }
  return best
}

export function isActivePath(pathname: string, path?: string) {
  if (!path) return false
  if (path === '/panel') return pathname === '/panel' || pathname === '/panel/'
  return pathname === path || pathname.startsWith(path + '/')
}
