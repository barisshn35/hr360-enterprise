import { Suspense, lazy, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Clock, Inbox, TriangleAlert, UserPlus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelHead } from '@/components/ui/Panel'
import { StatCard, StatCardsSkeleton } from '@/components/ui/StatCard'
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

export function DashboardPage() {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Merhaba, ${firstName}` : 'Genel bakış'}
        description={
          overdueCount > 0
            ? `${overdueCount} talebin süresi geçti. Onay kutusunda sıradaki adımlar sizi bekliyor.`
            : 'Bekleyen işleriniz ve organizasyonun güncel durumu.'
        }
        actions={
          <StatusBadge tone={health.isError ? 'danger' : health.data ? 'success' : 'neutral'}>
            {health.isError
              ? 'Servis yanıt vermiyor'
              : health.data
                ? 'Servis çalışıyor'
                : 'Kontrol ediliyor'}
          </StatusBadge>
        }
      />

      {statsLoading ? (
        <StatCardsSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canSeeEmployees && (
            <Link to="/panel/calisanlar" className="focus-visible:outline-none">
              <StatCard
                label="Çalışan"
                count={employees.data?.length ?? 0}
                format={formatNumber}
                icon={Users}
                trend={`${formatNumber(activeCount)} aktif`}
                trendDirection="flat"
                trendSense="neutral"
                compareLabel="kadroda"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}

          {can('organization:view') && (
            <Link to="/panel/organizasyon" className="focus-visible:outline-none">
              <StatCard
                label="Şirket"
                count={companies.data?.length ?? 0}
                format={formatNumber}
                icon={Building2}
                trend={`${formatNumber(departmentCount)} departman`}
                trendDirection="flat"
                trendSense="neutral"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}

          {can('workflow:view') && (
            <Link to="/panel/onaylar" className="focus-visible:outline-none">
              <StatCard
                label="Bekleyen onay"
                count={pending.data?.length ?? 0}
                format={formatNumber}
                icon={Inbox}
                trend="Karar bekliyor"
                trendDirection="flat"
                trendSense="neutral"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}

          {canDecide && (
            <Link to="/panel/onaylar?durum=gecikmis" className="focus-visible:outline-none">
              <StatCard
                label="Süresi geçen"
                count={overdueCount}
                format={formatNumber}
                icon={overdueCount > 0 ? TriangleAlert : Clock}
                trend={overdueCount > 0 ? 'Öncelikli' : 'Tümü süresinde'}
                trendDirection={overdueCount > 0 ? 'up' : 'flat'}
                trendSense="negative"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}

          {can('recruitment:view') && (
            <Link to="/panel/ise-alim" className="focus-visible:outline-none">
              <StatCard
                label="Yayındaki ilan"
                count={postings.data?.length ?? 0}
                format={formatNumber}
                icon={UserPlus}
                trend="Açık pozisyon"
                trendDirection="flat"
                trendSense="neutral"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}

          {can('leave:view') && (
            <Link to="/panel/izin" className="focus-visible:outline-none">
              <StatCard
                label="Bu ay izin"
                count={leaveThisMonth}
                format={formatNumber}
                icon={Clock}
                trend="Bu ay başlayan"
                trendDirection="flat"
                trendSense="neutral"
                className="h-full transition-colors hover:border-primary/40"
              />
            </Link>
          )}
        </div>
      )}

      {can('workflow:view') && (
        <Suspense fallback={<div className="h-[260px] animate-pulse rounded-[28px] bg-muted/50" />}>
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
                  className="cursor-pointer text-[13px] font-semibold text-primary underline-offset-2 hover:underline"
                >
                  Onay kutusu
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
              <ul className="divide-y divide-border">
                {queue.map((w) => {
                  const late = w.slaDueAt ? new Date(w.slaDueAt).getTime() < Date.now() : false
                  return (
                    <li key={w.id}>
                      <Link
                        to={`/panel/onaylar/${w.id}`}
                        className="flex cursor-pointer items-start justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-muted/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium">
                            {w.subject || workflowTypeLabels[w.type]}
                          </span>
                          <span className="mt-0.5 block text-[12px] text-muted-foreground">
                            {workflowTypeLabels[w.type]}, {formatDate(w.createdAt)} tarihinde açıldı
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
                title="Şirket kaydı yok"
                detail="Organizasyon sayfasından ilk şirketi ekleyin; departmanlar onun altına bağlanır."
              />
            ) : (
              <ul className="divide-y divide-border">
                {companies.data!.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/panel/organizasyon/${c.id}`}
                      className="flex cursor-pointer items-baseline justify-between gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
                    >
                      <span className="min-w-0 truncate text-[14px] font-medium">{c.name}</span>
                      <span className="tabular shrink-0 text-[12px] text-muted-foreground">
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
