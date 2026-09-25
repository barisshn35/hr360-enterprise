import { useMemo, useState } from 'react'
import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable'
import { StatCard, StatCardsSkeleton } from '@/components/ui/StatCard'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { ProgressBar } from '@/components/ui/Progress'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { CenteredSpinner, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import {
  useChangeTenantPlan,
  useReactivateTenant,
  useSuspendTenant,
  useTenant,
  useTenants,
} from '@/api/queries-tenant'
import {
  tenantPlanLabels,
  tenantPlanQuota,
  tenantStatusLabels,
  type ProvisioningLogEntry,
  type Tenant,
  type TenantPlan,
  type TenantStatus,
} from '@/api/tenant'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const ALL = '__all__'

const STATUS_TONE: Record<TenantStatus, StatusTone> = {
  Pending: 'warning',
  Active: 'success',
  Suspended: 'danger',
  Cancelled: 'neutral',
}

/* --------------------------- Kurulum (provisioning) --------------------------- */

const STEP_TONE: Record<string, StatusTone> = {
  Succeeded: 'success',
  Failed: 'danger',
  Pending: 'warning',
}

const STEP_LABEL: Record<string, string> = {
  Succeeded: 'Başarılı',
  Failed: 'Başarısız',
  Pending: 'Sürüyor',
}

/**
 * Kayıt sırasında arka planda çalışan adımların zaman çizelgesi.
 *
 * Kiracı `Pending`te takılı kaldığında tek teşhis yolu bu — hangi adımın
 * patladığı ve hata mesajı burada görünür.
 */
function ProvisioningTimeline({ entries }: { entries: ProvisioningLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Bu kiracı için kurulum kaydı yok. Kayıt eski bir sürümle yapılmış ya da servis günlük
        tutmuyor olabilir.
      </p>
    )
  }

  return (
    <ol className="relative space-y-5 pl-6">
      <span aria-hidden="true" className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />
      {entries.map((entry, i) => {
        const tone = STEP_TONE[entry.status] ?? 'neutral'
        const Icon =
          entry.status === 'Succeeded'
            ? CircleCheck
            : entry.status === 'Failed'
              ? CircleX
              : LoaderCircle
        return (
          <li key={entry.id ?? `${entry.step}-${i}`} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0.5 -left-6 flex size-4 items-center justify-center rounded-full bg-card',
                tone === 'success'
                  ? 'text-[hsl(var(--success))]'
                  : tone === 'danger'
                    ? 'text-destructive'
                    : 'text-[hsl(var(--warning))]',
              )}
            >
              <Icon className={cn('size-4', entry.status === 'Pending' && 'animate-spin')} />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-[13px] font-medium">{entry.step}</p>
              <StatusBadge tone={tone}>{STEP_LABEL[entry.status] ?? entry.status}</StatusBadge>
            </div>
            {entry.message && (
              <p
                className={cn(
                  'mt-1 text-[12px] leading-relaxed break-words',
                  tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
                )}
              >
                {entry.message}
              </p>
            )}
            {(entry.startedAt || entry.completedAt) && (
              <p className="tabular mt-1 text-[11px] text-muted-foreground">
                {entry.startedAt ? formatDateTime(entry.startedAt) : '—'}
                {entry.completedAt ? ` → ${formatDateTime(entry.completedAt)}` : ''}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* --------------------------------- Eylemler --------------------------------- */

function SuspendModal({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const toast = useToast()
  const suspend = useSuspendTenant()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | undefined>()

  if (!tenant) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 5) return setError('Askıya alma gerekçesi en az 5 karakter olmalı.')
    setError(undefined)
    suspend.mutate(
      { id: tenant!.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.ok(`${tenant!.name} askıya alındı`)
          setReason('')
          onClose()
        },
        onError: (e2: unknown) =>
          toast.stop(e2 instanceof Error ? e2.message : 'Kiracı askıya alınamadı.'),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Kiracıyı askıya al"
      note={`${tenant.name} (${tenant.slug})`}
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={suspend.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="suspend-tenant"
            variant="destructive"
            className="cursor-pointer"
            disabled={suspend.isPending}
          >
            {suspend.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Askıya al
          </Button>
        </>
      }
    >
      <form id="suspend-tenant" onSubmit={submit} noValidate className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-[13px] leading-relaxed">
            Askıya alınan kiracının kullanıcıları oturum açamaz ve verilerine erişemez. Veriler
            silinmez; yeniden etkinleştirildiğinde erişim geri gelir.
          </p>
        </div>
        <TextAreaField
          id="suspend-reason"
          label="Gerekçe"
          rows={3}
          required
          hint="Kayda geçer; destek görüşmelerinde referans alınır."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={error}
        />
      </form>
    </Modal>
  )
}

function PlanModal({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const toast = useToast()
  const changePlan = useChangeTenantPlan()
  const [plan, setPlan] = useState<TenantPlan>(tenant?.plan ?? 'Standard')
  const [maxEmployees, setMax] = useState(String(tenant?.maxEmployees ?? 250))
  const [touched, setTouched] = useState(false)

  if (!tenant) return null

  /** Plan değişince kota planın varsayılanına gider — kullanıcı elle değiştirmediyse. */
  const onPlanChange = (v: string) => {
    const next = v as TenantPlan
    setPlan(next)
    if (!touched) setMax(String(tenantPlanQuota[next]))
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    changePlan.mutate(
      { id: tenant.id, plan, maxEmployees: Number(maxEmployees) || tenantPlanQuota[plan] },
      {
        onSuccess: () => {
          toast.ok(`${tenant.name} planı ${tenantPlanLabels[plan]} olarak güncellendi`)
          onClose()
        },
        onError: (e2: unknown) =>
          toast.stop(e2 instanceof Error ? e2.message : 'Plan güncellenemedi.'),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Planı değiştir"
      note={`${tenant.name} (${tenant.slug})`}
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={changePlan.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="tenant-plan"
            className="cursor-pointer"
            disabled={changePlan.isPending}
          >
            {changePlan.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Planı kaydet
          </Button>
        </>
      }
    >
      <form id="tenant-plan" onSubmit={submit} noValidate className="space-y-4">
        <SelectField
          id="tenant-plan-select"
          label="Plan"
          value={plan}
          onChange={onPlanChange}
          options={(Object.keys(tenantPlanLabels) as TenantPlan[]).map((p) => ({
            value: p,
            label: `${tenantPlanLabels[p]} — ${formatNumber(tenantPlanQuota[p])} çalışan`,
          }))}
        />
        <TextField
          id="tenant-max-employees"
          label="Çalışan kotası"
          type="number"
          min={1}
          required
          className="tabular"
          hint="Plan varsayılanından farklı bir kota tanımlayabilirsiniz."
          value={maxEmployees}
          onChange={(e) => {
            setTouched(true)
            setMax(e.target.value)
          }}
        />
      </form>
    </Modal>
  )
}

/* -------------------------------- Detay çekmecesi -------------------------------- */

function TenantDetail({ tenantId, onClose }: { tenantId: string | null; onClose: () => void }) {
  const detail = useTenant(tenantId ?? undefined)

  return (
    <Sheet open={Boolean(tenantId)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{detail.data?.name ?? 'Kiracı detayı'}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {detail.isPending ? (
            <CenteredSpinner label="Kiracı yükleniyor" />
          ) : detail.isError || !detail.data ? (
            <ErrorState
              title="Kiracı bilgisi alınamadı"
              message={detail.error instanceof Error ? detail.error.message : undefined}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <>
              <dl className="divide-y divide-border">
                {[
                  { label: 'Kısa ad', value: detail.data.slug, mono: true },
                  { label: 'Durum', value: tenantStatusLabels[detail.data.status] },
                  { label: 'Plan', value: tenantPlanLabels[detail.data.plan] },
                  {
                    label: 'Çalışan kotası',
                    value: `${formatNumber(detail.data.employeeCount ?? 0)} / ${formatNumber(detail.data.maxEmployees)}`,
                  },
                  { label: 'Yönetici e-postası', value: detail.data.adminEmail ?? '—' },
                  { label: 'E-posta alan adı', value: detail.data.emailDomain ?? '—' },
                  { label: 'Vergi numarası', value: detail.data.taxNumber ?? '—' },
                  { label: 'Kayıt', value: formatDateTime(detail.data.createdAt) },
                  ...(detail.data.suspendedAt
                    ? [
                        {
                          label: 'Askıya alınma',
                          value: formatDateTime(detail.data.suspendedAt),
                        },
                        {
                          label: 'Askı gerekçesi',
                          value: detail.data.suspensionReason ?? '—',
                        },
                      ]
                    : []),
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                  >
                    <dt className="text-[12px] text-muted-foreground">{row.label}</dt>
                    <dd
                      className={cn(
                        'text-right text-[13px] break-all',
                        row.mono && 'font-mono',
                      )}
                    >
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div>
                <h3 className="mb-3 text-[14px] font-semibold">Kurulum kayıtları</h3>
                <ProvisioningTimeline entries={detail.data.provisioningLog ?? []} />
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/* ----------------------------------- Sayfa ----------------------------------- */

export function TenantsPage() {
  const toast = useToast()
  const [status, setStatus] = useState<string>(ALL)
  const [openId, setOpenId] = useState<string | null>(null)
  const [suspendFor, setSuspendFor] = useState<Tenant | null>(null)
  const [planFor, setPlanFor] = useState<Tenant | null>(null)

  const tenants = useTenants({ status: status === ALL ? undefined : (status as TenantStatus) })
  const reactivate = useReactivateTenant()

  const stats = useMemo(() => {
    const list = tenants.data ?? []
    return {
      total: list.length,
      active: list.filter((t) => t.status === 'Active').length,
      pending: list.filter((t) => t.status === 'Pending').length,
      suspended: list.filter((t) => t.status === 'Suspended').length,
    }
  }, [tenants.data])

  const filters: TableFilter[] = [
    {
      id: 'status',
      label: 'Durum',
      value: status,
      onChange: setStatus,
      options: [
        { value: ALL, label: 'Tüm durumlar' },
        ...(Object.keys(tenantStatusLabels) as TenantStatus[]).map((s) => ({
          value: s,
          label: tenantStatusLabels[s],
        })),
      ],
    },
  ]

  const columns: Array<Column<Tenant>> = [
    {
      id: 'name',
      header: 'Şirket',
      searchText: (t) => `${t.name} ${t.slug} ${t.adminEmail ?? ''}`,
      sortValue: (t) => t.name,
      exportText: (t) => t.name,
      cell: (t) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground">
            {t.name.charAt(0).toLocaleUpperCase('tr-TR')}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{t.name}</p>
            <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground">{t.slug}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'plan',
      header: 'Plan',
      hideBelow: 'sm',
      sortValue: (t) => tenantPlanLabels[t.plan] ?? '',
      exportText: (t) => tenantPlanLabels[t.plan] ?? '',
      cell: (t) => <StatusBadge tone="info">{tenantPlanLabels[t.plan]}</StatusBadge>,
    },
    {
      id: 'quota',
      header: 'Çalışan kotası',
      hideBelow: 'md',
      sortValue: (t) => (t.employeeCount ?? 0) / Math.max(1, t.maxEmployees),
      exportText: (t) => `${t.employeeCount ?? 0}/${t.maxEmployees}`,
      cell: (t) => {
        const used = t.employeeCount ?? 0
        const ratio = used / Math.max(1, t.maxEmployees)
        return (
          <div className="flex min-w-32 items-center gap-3">
            <ProgressBar
              value={used}
              max={t.maxEmployees || 1}
              tone={ratio >= 0.95 ? 'danger' : ratio >= 0.8 ? 'warning' : 'info'}
              label={`${t.name} çalışan kotası`}
            />
            <span className="tabular shrink-0 text-[12px] text-muted-foreground">
              {formatNumber(used)}/{formatNumber(t.maxEmployees)}
            </span>
          </div>
        )
      },
    },
    {
      id: 'createdAt',
      header: 'Kayıt',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (t) => new Date(t.createdAt).getTime(),
      exportText: (t) => formatDate(t.createdAt),
      cell: (t) => <span className="tabular text-muted-foreground">{formatDate(t.createdAt)}</span>,
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (t) => tenantStatusLabels[t.status] ?? '',
      exportText: (t) => tenantStatusLabels[t.status] ?? '',
      cell: (t) => (
        <StatusBadge tone={STATUS_TONE[t.status] ?? 'neutral'}>
          {tenantStatusLabels[t.status]}
        </StatusBadge>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kiracılar"
        description="Platformdaki tüm şirketler, planları ve kurulum durumları. Bu sayfa yalnızca platform yönetimine açıktır."
      />

      {tenants.isPending ? (
        <StatCardsSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Toplam kiracı"
            count={stats.total}
            format={formatNumber}
            trend="Kayıtlı şirket"
            trendDirection="flat"
            trendSense="neutral"
          />
          <StatCard
            label="Aktif"
            count={stats.active}
            format={formatNumber}
            trend="Çalışıyor"
            trendDirection="flat"
            trendSense="positive"
          />
          <StatCard
            label="Hazırlanıyor"
            count={stats.pending}
            format={formatNumber}
            trend={stats.pending > 0 ? 'Kurulum sürüyor' : 'Bekleyen yok'}
            trendDirection={stats.pending > 0 ? 'up' : 'flat'}
            trendSense="negative"
          />
          <StatCard
            label="Askıda"
            count={stats.suspended}
            format={formatNumber}
            trend={stats.suspended > 0 ? 'Erişim kapalı' : 'Askıda kiracı yok'}
            trendDirection={stats.suspended > 0 ? 'up' : 'flat'}
            trendSense="negative"
          />
        </div>
      )}

      <DataTable
        rows={tenants.data}
        rowKey={(t) => t.id}
        columns={columns}
        filters={filters}
        isLoading={tenants.isPending}
        error={tenants.error}
        onRetry={() => void tenants.refetch()}
        onRowClick={(t) => setOpenId(t.id)}
        searchPlaceholder="Şirket adı, kısa ad veya e-posta"
        exportFileName="kiracilar"
        pageSize={12}
        initialSort={{ columnId: 'createdAt', dir: 'desc' }}
        emptyTitle="Kiracı yok"
        emptyDetail="Bu filtreye uyan kiracı bulunmuyor."
        rowActions={[
          { label: 'Detay ve kurulum kaydı', onSelect: (t) => setOpenId(t.id) },
          {
            label: 'Planı değiştir',
            hidden: (t) => t.status === 'Cancelled',
            onSelect: (t) => setPlanFor(t),
          },
          {
            label: 'Askıya al',
            destructive: true,
            hidden: (t) => t.status !== 'Active' && t.status !== 'Pending',
            onSelect: (t) => setSuspendFor(t),
          },
          {
            label: 'Yeniden etkinleştir',
            hidden: (t) => t.status !== 'Suspended',
            onSelect: (t) =>
              reactivate.mutate(
                { id: t.id },
                {
                  onSuccess: () => toast.ok(`${t.name} yeniden etkinleştirildi`),
                  onError: (e: unknown) =>
                    toast.stop(e instanceof Error ? e.message : 'Kiracı etkinleştirilemedi.'),
                },
              ),
          },
        ]}
      />

      <TenantDetail tenantId={openId} onClose={() => setOpenId(null)} />
      <SuspendModal tenant={suspendFor} onClose={() => setSuspendFor(null)} />
      <PlanModal
        key={planFor?.id ?? 'none'}
        tenant={planFor}
        onClose={() => setPlanFor(null)}
      />
    </div>
  )
}
