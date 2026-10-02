import { Suspense, lazy, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock,
  Inbox,
  TriangleAlert,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { Panel, PanelHead } from '@/components/ui/Panel'
import { StatCard, StatCardsSkeleton, type StatCardProps } from '@/components/ui/StatCard'
import { Button } from '@/components/ui/button'
import { FloatingPaths } from '@/components/ui/floating-paths'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { WorkflowStatusBadge } from '@/components/ui/ModuleBadges'
import { EmptyState, ErrorState, RowsSkeleton } from '@/components/ui/States'
import type { SeriesPoint } from '@/components/ui/metric-chart'
import { useAuth } from '@/auth/useAuth'
import {
  useCompanies,
  useEmployees,
  useGatewayHealth,
  useJobPostings,
  useLeaveRequests,
  useOverdueWorkflows,
  useWorkflows,
} from '@/api/queries'
import { EmployeeStatus, workflowTypeLabels } from '@/api/types'
import { formatDate, formatNumber, formatRelativeToNow } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EASE } from '@/motion/primitives'
import { localISODate } from '@/lib/dates'

/**
 * Recharts tek başına ~390 kB. Genel bakış ilk açılan ekran olduğu için
 * grafik kartı ayrı chunk'a alındı: panel açılırken grafik arkadan gelir.
 */
const ProgressMetricCard = lazy(() => import('@/components/ui/progress-metric-card'))

/** Son N günün gün gün talep sayısı — grafiğin verisi uydurma değil, gerçek. */
function dailySeries(dates: string[], days: number): SeriesPoint[] {
  const buckets = new Map<string, number>()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    buckets.set(localISODate(d), 0)
  }

  for (const value of dates) {
    // Zaman damgası UTC gelir; kullanıcının yerel gününe çevrilir.
    const key = value.length <= 10 ? value : localISODate(new Date(value))
    if (buckets.has(key)) buckets.set(key, buckets.get(key)! + 1)
  }

  return [...buckets.entries()].map(([date, value]) => ({ date, value }))
}

function greeting(now = new Date()) {
  const h = now.getHours()
  if (h < 5) return 'İyi geceler'
  if (h < 12) return 'Günaydın'
  if (h < 18) return 'İyi günler'
  return 'İyi akşamlar'
}

const todayLabel = () =>
  new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

type Kpi = StatCardProps & { key: string; to: string }

export function DashboardPage() {
  const reduced = useReducedMotion()
  const { user, can } = useAuth()
  const canSeeEmployees = can('employee:viewAll')
  const canDecide = can('workflow:decide')

  const employees = useEmployees({ enabled: canSeeEmployees })
  const companies = useCompanies({ enabled: can('organization:view') })
  const pending = useWorkflows({ status: 'Pending' }, { enabled: can('workflow:view') })
  const allWorkflows = useWorkflows({}, { enabled: can('workflow:view') })
  const overdue = useOverdueWorkflows({ enabled: canDecide })
  const postings = useJobPostings('Published')
  const leave = useLeaveRequests({}, can('leave:view'))
  const health = useGatewayHealth()

  const activeCount = useMemo(
    () => employees.data?.filter((e) => e.status === EmployeeStatus.Active).length ?? 0,
    [employees.data],
  )

  const departmentCount = useMemo(
    () => companies.data?.reduce((sum, c) => sum + (c.departments?.length ?? 0), 0) ?? 0,
    [companies.data],
  )

  const overdueCount = overdue.data?.length ?? 0

  const leaveThisMonth = useMemo(() => {
    const now = new Date()
    return (
      leave.data?.filter((r) => {
        const d = new Date(r.startDate)
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      }).length ?? 0
    )
  }, [leave.data])

  const requestSeries = useMemo(
    () => dailySeries((allWorkflows.data ?? []).map((w) => w.createdAt), 30),
    [allWorkflows.data],
  )

  /** Süresi geçenler önce, sonra en eski talep. */
  const queue = useMemo(
    () =>
      [...(pending.data ?? [])]
        .sort((a, b) => {
          const aLate = a.slaDueAt ? new Date(a.slaDueAt).getTime() < Date.now() : false
          const bLate = b.slaDueAt ? new Date(b.slaDueAt).getTime() < Date.now() : false
          if (aLate !== bLate) return aLate ? -1 : 1
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        })
        .slice(0, 7),
    [pending.data],
  )

  const firstName = user?.fullName?.split(' ')[0] ?? ''
  const statsLoading =
    (canSeeEmployees && employees.isPending) || pending.isPending || companies.isPending

  // Bekleyen onay kartındaki küçük grafik: son 14 günde açılan talepler (gerçek veri).
  const last14 = requestSeries.slice(-14)

  const kpis: Kpi[] = [
    canSeeEmployees && {
      key: 'employees',
      to: '/panel/calisanlar',
      label: 'Çalışan',
      count: employees.data?.length ?? 0,
      icon: Users,
      trend: `${formatNumber(activeCount)} aktif`,
      trendSense: 'neutral' as const,
      compareLabel: 'kadroda',
    },
    can('organization:view') && {
      key: 'companies',
      to: '/panel/organizasyon',
      label: 'Şirket',
      count: companies.data?.length ?? 0,
      icon: Building2,
      trend: `${formatNumber(departmentCount)} departman`,
      trendSense: 'neutral' as const,
    },
    can('workflow:view') && {
      key: 'pending',
      to: '/panel/onaylar',
      label: 'Bekleyen onay',
      count: pending.data?.length ?? 0,
      icon: Inbox,
      trend: 'Karar bekliyor',
      trendSense: 'neutral' as const,
      compareLabel: 'son 14 gün',
      series: last14.some((p) => p.value > 0) ? last14.map((p) => p.value) : undefined,
      seriesLabels: last14.map((p) => formatDate(p.date)),
    },
    canDecide && {
      key: 'overdue',
      to: '/panel/onaylar?durum=gecikmis',
      label: 'Süresi geçen',
      count: overdueCount,
      icon: overdueCount > 0 ? TriangleAlert : Clock,
      trend: overdueCount > 0 ? 'Öncelikli' : 'Tümü süresinde',
      trendDirection: overdueCount > 0 ? ('up' as const) : ('flat' as const),
      trendSense: 'negative' as const,
      attention: overdueCount > 0,
    },
    can('recruitment:view') && {
      key: 'postings',
      to: '/panel/ise-alim',
      label: 'Yayındaki ilan',
      count: postings.data?.length ?? 0,
      icon: UserPlus,
      trend: 'Açık pozisyon',
      trendSense: 'neutral' as const,
    },
    can('leave:view') && {
      key: 'leave',
      to: '/panel/izin',
      label: 'Bu ay izin',
      count: leaveThisMonth,
      icon: CalendarDays,
      trend: 'Bu ay başlayan',
      trendSense: 'neutral' as const,
    },
  ].filter(Boolean) as Kpi[]

  // 3'ün katıysa 3 sütun (6 kart 3+3), değilse 4 sütun: son satırda tek kart kalmasın.
  const kpiCols =
    kpis.length % 3 === 0 && kpis.length % 4 !== 0 ? 'xl:grid-cols-3' : 'xl:grid-cols-4'

  const quickActions = [
    can('leave:view') && { to: '/panel/izin', label: 'İzin talebi', icon: CalendarDays },
    can('expense:view') && { to: '/panel/masraf', label: 'Masraf bildir', icon: Wallet },
    can('workflow:view') && { to: '/panel/onaylar', label: 'Onay kutusu', icon: Inbox },
  ].filter(Boolean) as Array<{ to: string; label: string; icon: React.ElementType }>

  const healthTone = health.isError ? 'danger' : health.data ? 'success' : 'neutral'

  return (
    <div className="space-y-6">
      {/* --------------------------------- Karşılama --------------------------------- */}
      <motion.section
        initial={reduced ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="surface relative isolate overflow-hidden rounded-2xl px-6 py-7 sm:px-8 sm:py-8"
      >
        <FloatingPaths className="-z-10 opacity-50 [mask-image:linear-gradient(to_left,black,transparent_70%)]" />
        <div
          aria-hidden="true"
          className="hr-aurora absolute -top-24 -right-20 -z-10 size-80 rounded-full bg-primary/20 blur-[90px]"
        />
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted-foreground">
              <span className="first-letter:uppercase">{todayLabel()}</span>
              <span className="text-border">•</span>
              <StatusBadge tone={healthTone}>
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    healthTone === 'success' && 'bg-[hsl(var(--success))] shadow-[0_0_6px_hsl(var(--success))]',
                    healthTone === 'danger' && 'bg-destructive',
                    healthTone === 'neutral' && 'bg-muted-foreground',
                  )}
                />
                {health.isError ? 'Servis yanıt vermiyor' : health.data ? 'Tüm servisler çalışıyor' : 'Kontrol ediliyor'}
              </StatusBadge>
            </div>
            <h2 className="text-gradient mt-3 text-[28px] leading-tight font-semibold tracking-[-0.03em] sm:text-[34px]">
              {greeting()}
              {firstName ? `, ${firstName}` : ''}
            </h2>
            <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              {overdueCount > 0 ? (
                <>
                  <span className="font-medium text-[hsl(var(--warning))]">
                    {formatNumber(overdueCount)} talebin süresi geçti.
                  </span>{' '}
                  Onay kutusunda sıradaki adımlar sizi bekliyor.
                </>
              ) : (pending.data?.length ?? 0) > 0 ? (
                `${formatNumber(pending.data!.length)} talep kararınızı bekliyor; hepsi süresinde.`
              ) : (
                'Bekleyen işleriniz ve organizasyonun güncel durumu burada.'
              )}
            </p>
          </div>

          {quickActions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {quickActions.map(({ to, label, icon: Icon }, i) => (
                <Button key={to} asChild variant={i === 0 ? 'default' : 'outline'} size="sm" className="h-9">
                  <Link to={to}>
                    <Icon className="size-4" strokeWidth={1.75} />
                    {label}
                  </Link>
                </Button>
              ))}
            </div>
          )}
        </div>
      </motion.section>

      {/* ------------------------------------ KPI ------------------------------------ */}
      {statsLoading ? (
        <StatCardsSkeleton count={4} />
      ) : (
        kpis.length > 0 && (
          <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2', kpiCols)}>
            {kpis.map(({ key, to, ...card }, i) => (
              <motion.div
                key={key}
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 + i * 0.05, ease: EASE }}
              >
                <Link to={to} className="block h-full rounded-xl focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none">
                  <StatCard {...card} format={formatNumber} className="h-full" />
                </Link>
              </motion.div>
            ))}
          </div>
        )
      )}

      {can('workflow:view') && (
        <Suspense fallback={<div className="surface h-[260px] animate-pulse rounded-xl" />}>
          <ProgressMetricCard
            title="Açılan talepler"
            size="sm"
            accent="violet"
            deltaLabel="düne göre"
            unit="talep"
            loading={allWorkflows.isPending}
            data={requestSeries}
            dateFormatter={(d) => formatDate(d)}
            periodOptions={[
              { label: 'Son 7 gün', points: 7 },
              { label: 'Son 14 gün', points: 14 },
              { label: 'Son 30 gün' },
            ]}
            period="Son 14 gün"
          />
        </Suspense>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {can('workflow:view') && (
          <Panel>
            <PanelHead
              title="Sıradaki talepler"
              note="Süresi geçenler en üstte"
              action={
                <Link
                  to="/panel/onaylar"
                  className="group inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-primary"
                >
                  Onay kutusu
                  <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </Link>
              }
            />
            {pending.isPending ? (
              <RowsSkeleton rows={4} columns={3} />
            ) : pending.isError ? (
              <ErrorState
                message={pending.error instanceof Error ? pending.error.message : undefined}
                onRetry={() => void pending.refetch()}
              />
            ) : queue.length === 0 ? (
              <EmptyState
                title="Kuyruk boş"
                detail="Karar bekleyen talep yok. Yeni bir talep geldiğinde burada görünür."
              />
            ) : (
              <ul className="divide-y divide-border/70">
                {queue.map((w) => {
                  const late = w.slaDueAt ? new Date(w.slaDueAt).getTime() < Date.now() : false
                  return (
                    <li key={w.id}>
                      <Link
                        to={`/panel/onaylar/${w.id}`}
                        className="group flex cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-primary/[0.035]"
                      >
                        <span
                          className={cn(
                            'flex size-9 shrink-0 items-center justify-center rounded-lg ring-1',
                            late
                              ? 'bg-destructive/10 text-destructive ring-destructive/20'
                              : 'bg-muted text-muted-foreground ring-border',
                          )}
                        >
                          {late ? <TriangleAlert className="size-4" strokeWidth={1.75} /> : <Inbox className="size-4" strokeWidth={1.75} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">
                            {w.subject || workflowTypeLabels[w.type]}
                          </span>
                          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                            {workflowTypeLabels[w.type]} · {formatDate(w.createdAt)} tarihinde açıldı
                          </span>
                        </span>
                        <span className="shrink-0">
                          {w.slaDueAt ? (
                            <StatusBadge tone={late ? 'danger' : 'neutral'}>
                              {late ? 'Süresi geçti' : formatRelativeToNow(w.slaDueAt)}
                            </StatusBadge>
                          ) : (
                            <WorkflowStatusBadge status={w.status} />
                          )}
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        )}

        {can('organization:view') && (
          <Panel>
            <PanelHead title="Organizasyon" note="Şirket ve departman sayıları" />
            {companies.isPending ? (
              <RowsSkeleton rows={3} columns={2} />
            ) : companies.isError ? (
              <ErrorState
                message={companies.error instanceof Error ? companies.error.message : undefined}
                onRetry={() => void companies.refetch()}
              />
            ) : (companies.data?.length ?? 0) === 0 ? (
              <EmptyState
                icon={Building2}
                title="Şirket kaydı yok"
                detail="Organizasyon sayfasından ilk şirketi ekleyin; departmanlar onun altına bağlanır."
              />
            ) : (
              <ul className="divide-y divide-border/70">
                {companies.data!.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/panel/organizasyon/${c.id}`}
                      className="group flex cursor-pointer items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-primary/[0.035]"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/25 to-primary/5 text-[13px] font-semibold text-primary ring-1 ring-primary/20">
                        {c.name.charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{c.name}</span>
                      <span className="tabular shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">
                        {formatNumber(c.departments?.length ?? 0)} departman
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        )}
      </div>
    </div>
  )
}
