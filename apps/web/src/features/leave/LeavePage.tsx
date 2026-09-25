import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { LeaveStatusBadge } from '@/components/ui/ModuleBadges'
import { ProgressRing } from '@/components/ui/Progress'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { EmptyState, ErrorState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import type { StatusTone } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { leaveApi } from '@/api/leave'
import { useLeaveBalances, useLeaveRequests } from '@/api/queries'
import {
  leaveStatusLabels,
  leaveTypeLabels,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveStatus,
} from '@/api/types'
import { formatDate, formatNumber } from '@/lib/format'
import { NewBalanceModal } from './NewBalanceModal'
import { HolidaysModal } from './HolidaysModal'
import { NewLeaveRequestModal } from './NewLeaveRequestModal'

type TabKey = LeaveStatus | 'all'

const TABS: Array<TabDef<TabKey>> = [
  { key: 'Submitted', label: leaveStatusLabels.Submitted },
  { key: 'Approved', label: leaveStatusLabels.Approved },
  { key: 'Rejected', label: leaveStatusLabels.Rejected },
  { key: 'Cancelled', label: 'İptal' },
  { key: 'all', label: 'Tümü' },
]

/** Bakiye halkası: kalan gün vurgulu, kullanılan ve onaydaki ayrı okunur. */
function BalanceCard({ balance }: { balance: LeaveBalance }) {
  const tone: StatusTone =
    balance.remainingDays <= 0 ? 'danger' : balance.remainingDays <= 3 ? 'warning' : 'success'

  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-4">
      <ProgressRing
        value={balance.remainingDays}
        max={balance.entitledDays || 1}
        tone={tone}
        label={`${leaveTypeLabels[balance.type]} kalan gün`}
      >
        <span className="tabular text-[19px] leading-none font-bold">
          {formatNumber(balance.remainingDays)}
        </span>
        <span className="text-[10px] text-muted-foreground">gün</span>
      </ProgressRing>

      <div className="min-w-0">
        <p className="text-[14px] font-semibold">{leaveTypeLabels[balance.type]}</p>
        <dl className="mt-1.5 space-y-0.5 text-[12px] text-muted-foreground">
          <div className="flex gap-2">
            <dt>Hak edilen</dt>
            <dd className="tabular font-medium text-foreground">
              {formatNumber(balance.entitledDays)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Kullanılan</dt>
            <dd className="tabular font-medium text-foreground">
              {formatNumber(balance.usedDays)}
            </dd>
          </div>
          {balance.pendingDays > 0 && (
            <div className="flex gap-2">
              <dt>Onayda</dt>
              <dd className="tabular font-medium text-[hsl(var(--warning))]">
                {formatNumber(balance.pendingDays)}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

export function LeavePage() {
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useTabParam<TabKey>('durum', 'Submitted')
  const [employeeId, setEmployeeId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [holidaysOpen, setHolidaysOpen] = useState(false)

  const year = new Date().getFullYear()
  const balances = useLeaveBalances(employeeId || undefined, year, Boolean(employeeId))
  const requests = useLeaveRequests({
    employeeId: employeeId || undefined,
    status: tab === 'all' ? undefined : tab,
  })

  const cancel = useMutation({
    mutationFn: (id: string) => leaveApi.cancelRequest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] })
      toast.ok('Talep iptal edildi')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Talep iptal edilemedi.'),
  })

  const rows = useMemo(
    () =>
      [...(requests.data ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [requests.data],
  )

  const columns: Array<Column<LeaveRequest>> = [
    {
      id: 'type',
      header: 'İzin türü',
      searchText: (r) => `${leaveTypeLabels[r.type]} ${r.reason ?? ''}`,
      sortValue: (r) => leaveTypeLabels[r.type],
      cell: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{leaveTypeLabels[r.type]}</p>
          {r.reason && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{r.reason}</p>}
        </div>
      ),
    },
    {
      id: 'range',
      header: 'Tarih aralığı',
      hideBelow: 'sm',
      sortValue: (r) => new Date(r.startDate).getTime(),
      exportText: (r) => `${formatDate(r.startDate)} – ${formatDate(r.endDate)}`,
      cell: (r) => (
        <span className="tabular text-muted-foreground">
          {formatDate(r.startDate)} – {formatDate(r.endDate)}
        </span>
      ),
    },
    {
      id: 'days',
      header: 'Gün',
      align: 'right',
      sortValue: (r) => r.days,
      exportText: (r) => String(r.days),
      cell: (r) => formatNumber(r.days),
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (r) => leaveStatusLabels[r.status],
      exportText: (r) => leaveStatusLabels[r.status],
      cell: (r) => <LeaveStatusBadge status={r.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="İzin"
        description="İzin talepleri ve yıllık bakiyeler. Onay, Onay kutusu üzerinden ilerler."
        actions={
          <>
            {can('leave:manageBalance') && (
              <Button variant="outline" className="cursor-pointer" onClick={() => setHolidaysOpen(true)}>
                Resmi tatiller
              </Button>
            )}
            {can('leave:manageBalance') && (
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => setBalanceOpen(true)}
              >
                <Plus className="size-4" />
                Bakiye tanımla
              </Button>
            )}
            {can('leave:create') && (
              <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
                <Plus className="size-4" />
                Yeni izin talebi
              </Button>
            )}
          </>
        }
      />

      <div className="max-w-sm">
        <EmployeePicker
          value={employeeId}
          onChange={setEmployeeId}
          hint="Bakiyeleri görmek için çalışan seçin."
        />
      </div>

      {employeeId && (
        <Panel>
          <PanelHead title={`${year} bakiyeleri`} note="Kalan gün halkanın içinde" />
          {balances.isPending ? (
            <RowsSkeleton rows={2} columns={3} />
          ) : balances.isError ? (
            <ErrorState
              message={balances.error instanceof Error ? balances.error.message : undefined}
              onRetry={() => void balances.refetch()}
            />
          ) : (balances.data?.length ?? 0) === 0 ? (
            <EmptyState
              title="Bakiye tanımlı değil"
              detail="Bu çalışan için bu yıla ait izin bakiyesi girilmemiş."
              action={
                can('leave:manageBalance') ? (
                  <Button size="sm" className="cursor-pointer" onClick={() => setBalanceOpen(true)}>
                    Bakiye tanımla
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <PanelBody>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {balances.data!.map((b) => (
                  <BalanceCard key={b.id} balance={b} />
                ))}
              </div>
            </PanelBody>
          )}
        </Panel>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="İzin talebi durumu" />

      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        isLoading={requests.isPending}
        error={requests.error}
        onRetry={() => void requests.refetch()}
        searchPlaceholder="İzin türü veya gerekçe ara"
        exportFileName="izin-talepleri"
        emptyTitle="Bu durumda izin talebi yok"
        emptyDetail={
          employeeId
            ? 'Seçili çalışan için bu durumda kayıt bulunmuyor.'
            : 'Başka bir durum sekmesi seçin ya da yeni bir talep oluşturun.'
        }
        rowActions={[
          {
            label: 'Talebi iptal et',
            destructive: true,
            hidden: (r) => !(r.status === 'Submitted' || r.status === 'Draft') || cancel.isPending,
            onSelect: (r) => cancel.mutate(r.id),
          },
        ]}
        notice={
          <InfoNote>
            <strong className="font-semibold text-foreground">
              Onay bu ekrandan verilmez.
            </strong>{' '}
            Talep gönderilince onay zinciri <em>Onay kutusu</em> üzerinden ilerler; onaylandığında
            izin kaydı ve bakiye Kafka olayıyla kendiliğinden güncellenir. Buradan yalnızca kendi
            bekleyen talebinizi iptal edebilirsiniz.
          </InfoNote>
        }
      />

      <NewLeaveRequestModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultEmployeeId={employeeId}
      />

      <HolidaysModal open={holidaysOpen} onClose={() => setHolidaysOpen(false)} year={year} />

      <NewBalanceModal
        open={balanceOpen}
        onClose={() => setBalanceOpen(false)}
        defaultEmployeeId={employeeId}
        defaultYear={year}
      />
    </div>
  )
}
