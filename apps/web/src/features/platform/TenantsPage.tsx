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
import { useConfirm } from '@/components/ui/Confirm'
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
import { tx, appLocale } from '@/lib/i18n'

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
  Succeeded: tx('Başarılı'),
  Failed: tx('Başarısız'),
  Pending: tx('Sürüyor'),
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
        {tx('Bu kiracı için kurulum kaydı yok. Kayıt eski bir sürümle yapılmış ya da servis günlük tutmuyor olabilir.')}
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
    if (reason.trim().length < 5) return setError(tx('Askıya alma gerekçesi en az 5 karakter olmalı.'))
    setError(undefined)
    suspend.mutate(
      { id: tenant!.id, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.ok(tx('{0} askıya alındı', [tenant!.name]))
          setReason('')
          onClose()
        },
        onError: (e2: unknown) =>
          toast.stop(e2 instanceof Error ? e2.message : tx('Kiracı askıya alınamadı.')),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tx('Kiracıyı askıya al')}
      note={`${tenant.name} (${tenant.slug})`}
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={suspend.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            type="submit"
            form="suspend-tenant"
            variant="destructive"
            className="cursor-pointer"
            disabled={suspend.isPending}
          >
            {suspend.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Askıya al')}
          </Button>
        </>
      }
    >
      <form id="suspend-tenant" onSubmit={submit} noValidate className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-[13px] leading-relaxed">
            {tx('Askıya alınan kiracının kullanıcıları oturum açamaz ve verilerine erişemez. Veriler silinmez; yeniden etkinleştirildiğinde erişim geri gelir.')}
          </p>
        </div>
        <TextAreaField
          id="suspend-reason"
          label={tx('Gerekçe')}
          rows={3}
          required
          hint={tx('Kayda geçer; destek görüşmelerinde referans alınır.')}
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
          toast.ok(tx('{0} planı {1} olarak güncellendi', [tenant.name, tenantPlanLabels[plan]]))
          onClose()
        },
        onError: (e2: unknown) =>
          toast.stop(e2 instanceof Error ? e2.message : tx('Plan güncellenemedi.')),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={tx('Planı değiştir')}
      note={`${tenant.name} (${tenant.slug})`}
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={changePlan.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            type="submit"
            form="tenant-plan"
            className="cursor-pointer"
            disabled={changePlan.isPending}
          >
            {changePlan.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Planı kaydet')}
          </Button>
        </>
      }
    >
      <form id="tenant-plan" onSubmit={submit} noValidate className="space-y-4">
        <SelectField
          id="tenant-plan-select"
          label={tx('Plan')}
          value={plan}
          onChange={onPlanChange}
          options={(Object.keys(tenantPlanLabels) as TenantPlan[]).map((p) => ({
            value: p,
            label: tx('{0} — {1} çalışan', [tenantPlanLabels[p], formatNumber(tenantPlanQuota[p])]),
          }))}
        />
        <TextField
          id="tenant-max-employees"
          label={tx('Çalışan kotası')}
          type="number"
          min={1}
          required
          className="tabular"
          hint={tx('Plan varsayılanından farklı bir kota tanımlayabilirsiniz.')}
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
          <SheetTitle>{detail.data?.name ?? tx('Kiracı detayı')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8">
          {detail.isPending ? (
            <CenteredSpinner label={tx('Kiracı yükleniyor')} />
          ) : detail.isError || !detail.data ? (
            <ErrorState
              title={tx('Kiracı bilgisi alınamadı')}
              message={detail.error instanceof Error ? detail.error.message : undefined}
              onRetry={() => void detail.refetch()}
            />
          ) : (
            <>
              <dl className="divide-y divide-border">
                {[
                  { label: tx('Kısa ad'), value: detail.data.slug, mono: true },
                  { label: tx('Durum'), value: tenantStatusLabels[detail.data.status] },
                  { label: tx('Plan'), value: tenantPlanLabels[detail.data.plan] },
                  {
                    label: tx('Çalışan kotası'),
                    value: `${formatNumber(detail.data.employeeCount ?? 0)} / ${formatNumber(detail.data.maxEmployees)}`,
                  },
                  { label: tx('Yönetici e-postası'), value: detail.data.adminEmail ?? '—' },
                  { label: tx('E-posta alan adı'), value: detail.data.emailDomain ?? '—' },
                  { label: tx('Vergi numarası'), value: detail.data.taxNumber ?? '—' },
                  { label: tx('Kayıt'), value: formatDateTime(detail.data.createdAt) },
                  ...(detail.data.suspendedAt
                    ? [
                        {
                          label: tx('Askıya alınma'),
                          value: formatDateTime(detail.data.suspendedAt),
                        },
                        {
                          label: tx('Askı gerekçesi'),
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
                <h3 className="mb-3 text-[14px] font-semibold">{tx('Kurulum kayıtları')}</h3>
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

  // Tüm kiracılar bir kez çekilir; durum filtresi istemcide uygulanır. Böylece üstteki
  // istatistik kartları (toplam/aktif/…) filtreden bağımsız, tüm platformu gösterir.
  const tenants = useTenants()
  const rows = useMemo(
    () => (status === ALL ? tenants.data : tenants.data?.filter((t) => t.status === status)),
    [tenants.data, status],
  )
  const reactivate = useReactivateTenant()
  const confirm = useConfirm()
  const askReactivate = async (t: Tenant) => {
    const ok = await confirm({
      title: tx('{0} yeniden etkinleştirilsin mi?', [t.name]),
      note: tx('Askıya alma sırasında kapatılan kullanıcı hesapları yeniden açılır ve şirket platformu yeniden kullanabilir. Askı gerekçesi kayıttan silinir.'),
      action: tx('Yeniden etkinleştir'),
      destructive: false,
    })
    if (!ok) return
    reactivate.mutate(
      { id: t.id },
      {
        onSuccess: () => toast.ok(tx('{0} yeniden etkinleştirildi', [t.name])),
        onError: (e: unknown) =>
          toast.stop(e instanceof Error ? e.message : tx('Kiracı etkinleştirilemedi.')),
      },
    )
  }

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
      label: tx('Durum'),
      value: status,
      onChange: setStatus,
      options: [
        { value: ALL, label: tx('Tüm durumlar') },
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
      header: tx('Şirket'),
      searchText: (t) => `${t.name} ${t.slug} ${t.adminEmail ?? ''}`,
      sortValue: (t) => t.name,
      exportText: (t) => t.name,
      cell: (t) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground">
            {t.name.charAt(0).toLocaleUpperCase(appLocale)}
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
      header: tx('Plan'),
      hideBelow: 'sm',
      sortValue: (t) => tenantPlanLabels[t.plan] ?? '',
      exportText: (t) => tenantPlanLabels[t.plan] ?? '',
      cell: (t) => <StatusBadge tone="info">{tenantPlanLabels[t.plan]}</StatusBadge>,
    },
    {
      id: 'quota',
      header: tx('Çalışan kotası'),
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
              label={tx('{0} çalışan kotası', [t.name])}
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
      header: tx('Kayıt'),
      align: 'right',
      hideBelow: 'lg',
      sortValue: (t) => new Date(t.createdAt).getTime(),
      exportText: (t) => formatDate(t.createdAt),
      cell: (t) => <span className="tabular text-muted-foreground">{formatDate(t.createdAt)}</span>,
    },
    {
      id: 'status',
      header: tx('Durum'),
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
        title={tx('Kiracılar')}
        description={tx('Platformdaki tüm şirketler, planları ve kurulum durumları. Bu sayfa yalnızca platform yönetimine açıktır.')}
      />

      {tenants.isPending ? (
        <StatCardsSkeleton count={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={tx('Toplam kiracı')}
            count={stats.total}
            format={formatNumber}
            trend={tx('Kayıtlı şirket')}
            trendDirection="flat"
            trendSense="neutral"
          />
          <StatCard
            label={tx('Aktif')}
            count={stats.active}
            format={formatNumber}
            trend={tx('Çalışıyor')}
            trendDirection="flat"
            trendSense="positive"
          />
          <StatCard
            label={tx('Hazırlanıyor')}
            count={stats.pending}
            format={formatNumber}
            trend={stats.pending > 0 ? tx('Kurulum sürüyor') : tx('Bekleyen yok')}
            trendDirection={stats.pending > 0 ? 'up' : 'flat'}
            trendSense="negative"
          />
          <StatCard
            label={tx('Askıda')}
            count={stats.suspended}
            format={formatNumber}
            trend={stats.suspended > 0 ? tx('Erişim kapalı') : tx('Askıda kiracı yok')}
            trendDirection={stats.suspended > 0 ? 'up' : 'flat'}
            trendSense="negative"
          />
        </div>
      )}

      <DataTable
        rows={rows}
        rowKey={(t) => t.id}
        columns={columns}
        filters={filters}
        isLoading={tenants.isPending}
        error={tenants.error}
        onRetry={() => void tenants.refetch()}
        onRowClick={(t) => setOpenId(t.id)}
        searchPlaceholder={tx('Şirket adı, kısa ad veya e-posta')}
        exportFileName="kiracilar"
        pageSize={12}
        initialSort={{ columnId: 'createdAt', dir: 'desc' }}
        emptyTitle={tx('Kiracı yok')}
        emptyDetail={tx('Bu filtreye uyan kiracı bulunmuyor.')}
        rowActions={[
          { label: tx('Detay ve kurulum kaydı'), onSelect: (t) => setOpenId(t.id) },
          {
            label: tx('Planı değiştir'),
            hidden: (t) => t.status === 'Cancelled',
            onSelect: (t) => setPlanFor(t),
          },
          {
            label: tx('Askıya al'),
            destructive: true,
            hidden: (t) => t.status !== 'Active' && t.status !== 'Pending',
            onSelect: (t) => setSuspendFor(t),
          },
          {
            label: tx('Yeniden etkinleştir'),
            hidden: (t) => t.status !== 'Suspended',
            onSelect: (t) => void askReactivate(t),
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
