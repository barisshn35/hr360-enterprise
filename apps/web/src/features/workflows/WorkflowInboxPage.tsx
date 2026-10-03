import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Plus, UserRoundCog, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { WorkflowStatusBadge } from '@/components/ui/ModuleBadges'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { InfoNote } from '@/components/ui/States'
import { useAuth } from '@/auth/useAuth'
import { useEmployees, useMyEmployeeId, useOverdueWorkflows, useWorkflows } from '@/api/queries'
import { workflowApi } from '@/api/workflows'
import { useAction } from '@/features/shared/kit'
import { DelegationsModal } from './DelegationsModal'
import {
  workflowStatusLabels,
  workflowTypeLabels,
  type Workflow,
  type WorkflowStatus,
} from '@/api/types'
import { formatDate, formatRelativeToNow, fullName } from '@/lib/format'
import { NewWorkflowModal } from './NewWorkflowModal'
import { tx } from '@/lib/i18n'

type TabKey = WorkflowStatus | 'all' | 'gecikmis'

export function WorkflowInboxPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [modalOpen, setModalOpen] = useState(false)
  const [delegating, setDelegating] = useState(false)
  const me = useMyEmployeeId()
  const [tab, setTab] = useTabParam<TabKey>('durum', 'Pending')

  // "Süresi geçen" ayrı bir uçtan gelir; yalnızca karar verebilenlere gösterilir.
  const canSeeOverdue = can('workflow:decide')
  const isOverdueTab = tab === 'gecikmis' && canSeeOverdue

  const list = useWorkflows(tab === 'all' || tab === 'gecikmis' ? {} : { status: tab }, {
    enabled: !isOverdueTab,
  })
  const overdue = useOverdueWorkflows({ enabled: isOverdueTab })
  const employees = useEmployees({ enabled: can('employee:viewAll') })

  const query = isOverdueTab ? overdue : list

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees.data ?? []) map.set(e.id, fullName(e))
    return map
  }, [employees.data])

  const nameOf = (id: string) => employeeNames.get(id) ?? `${id.slice(0, 8)}…`

  const rows = useMemo(
    () =>
      [...(query.data ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [query.data],
  )

  // Toplu karar: seçilen taleplerde sırası gelmiş ve onaycısı (ya da vekili) ben olan adım.
  const myStep = (w: Workflow) => {
    const step = [...(w.steps ?? [])].filter((s) => s.decision === 'Pending').sort((a, b) => a.order - b.order)[0]
    return step && me.employeeId && w.requesterEmployeeId !== me.employeeId
      && (step.approverEmployeeId === me.employeeId || step.delegatedToEmployeeId === me.employeeId) ? step : undefined
  }
  const bulk = useAction(({ ids, approve }: { ids: string[]; approve: boolean }) => {
    const items = rows.filter((w) => ids.includes(w.id)).flatMap((w) => { const st = myStep(w); return st ? [{ workflowId: w.id, stepId: st.id }] : [] })
    return workflowApi.bulkDecide(items, approve ? 'Approved' : 'Rejected')
  }, {
    success: (r) => tx('{0} talep karara bağlandı', [r.done]) + (r.results.length > r.done ? ' · ' + tx('{0} talep atlandı', [r.results.length - r.done]) : ''),
    invalidate: [['workflows']],
  })

  const tabs: Array<TabDef<TabKey>> = [
    { key: 'Pending', label: workflowStatusLabels.Pending },
    ...(canSeeOverdue ? [{ key: 'gecikmis' as TabKey, label: tx('Süresi geçen') }] : []),
    { key: 'Approved', label: workflowStatusLabels.Approved },
    { key: 'Rejected', label: workflowStatusLabels.Rejected },
    { key: 'all', label: tx('Tümü') },
  ]

  const columns: Array<Column<Workflow>> = [
    {
      id: 'subject',
      header: tx('Talep'),
      searchText: (w) => `${w.subject ?? ''} ${workflowTypeLabels[w.type]}`,
      sortValue: (w) => w.subject || workflowTypeLabels[w.type],
      cell: (w) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {w.subject || workflowTypeLabels[w.type]}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {workflowTypeLabels[w.type]}
          </p>
        </div>
      ),
    },
    {
      id: 'requester',
      header: tx('Talep eden'),
      hideBelow: 'md',
      searchText: (w) => nameOf(w.requesterEmployeeId),
      sortValue: (w) => nameOf(w.requesterEmployeeId),
      exportText: (w) => nameOf(w.requesterEmployeeId),
      cell: (w) => <span className="text-muted-foreground">{nameOf(w.requesterEmployeeId)}</span>,
    },
    {
      id: 'createdAt',
      header: tx('Açılış'),
      hideBelow: 'lg',
      sortValue: (w) => new Date(w.createdAt).getTime(),
      exportText: (w) => formatDate(w.createdAt),
      cell: (w) => <span className="tabular text-muted-foreground">{formatDate(w.createdAt)}</span>,
    },
    {
      id: 'sla',
      header: tx('SLA'),
      hideBelow: 'sm',
      sortValue: (w) => (w.slaDueAt ? new Date(w.slaDueAt).getTime() : Number.MAX_SAFE_INTEGER),
      exportText: (w) =>
        w.slaDueAt ? formatDate(w.slaDueAt) : tx('Tanımsız'),
      cell: (w) => {
        if (!w.slaDueAt) return <span className="text-muted-foreground">—</span>
        const late = new Date(w.slaDueAt).getTime() < Date.now()
        if (w.status !== 'Pending')
          return <span className="tabular text-muted-foreground">{formatDate(w.slaDueAt)}</span>
        return (
          <StatusBadge tone={late ? 'danger' : 'neutral'}>
            {late ? tx('Süresi geçti') : formatRelativeToNow(w.slaDueAt)}
          </StatusBadge>
        )
      },
    },
    {
      id: 'status',
      header: tx('Durum'),
      align: 'right',
      sortValue: (w) => workflowStatusLabels[w.status],
      exportText: (w) => workflowStatusLabels[w.status],
      cell: (w) => <WorkflowStatusBadge status={w.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={tx('Onay kutusu')}
        description={tx('İzin, masraf ve pozisyon talepleri tanımlı sırayla ilerler.')}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('workflow:decide') && (
              <Button variant="outline" className="cursor-pointer" onClick={() => setDelegating(true)}>
                <UserRoundCog className="size-4" />
                {tx('Vekâlet')}
              </Button>
            )}
            {can('workflow:create') && (
              <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
                <Plus className="size-4" />
                {tx('Yeni talep')}
              </Button>
            )}
          </div>
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={tx('Talep durumu')} />

      <DataTable
        rows={rows}
        rowKey={(w) => w.id}
        columns={columns}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        onRowClick={(w) => navigate(`/panel/onaylar/${w.id}`)}
        searchPlaceholder={tx('Talep veya tür ara')}
        exportFileName="onay-talepleri"
        pageSize={12}
        selectable={can('workflow:decide') && (tab === 'Pending' || isOverdueTab)}
        bulkActions={(ids) => {
          const n = rows.filter((w) => ids.includes(w.id) && myStep(w)).length
          return (
            <>
              <span className="text-[12.5px] text-muted-foreground">{tx('Kararınızı bekleyen: {0}', [n])}</span>
              <Button size="sm" disabled={!n || bulk.isPending} onClick={() => bulk.mutate({ ids, approve: true })}><Check className="size-4" /> {tx('Toplu onayla')}</Button>
              <Button size="sm" variant="outline" disabled={!n || bulk.isPending} onClick={() => bulk.mutate({ ids, approve: false })}><X className="size-4" /> {tx('Toplu reddet')}</Button>
            </>
          )
        }}
        emptyTitle={isOverdueTab ? tx('Süresi geçen talep yok') : tx('Bu durumda talep yok')}
        emptyDetail={
          isOverdueTab
            ? tx('Açık taleplerin tümü SLA süresi içinde ilerliyor.')
            : tx('Başka bir durum sekmesine geçerek diğer talepleri görebilirsiniz.')
        }
        notice={
          <InfoNote>
            {tx('Kararı talebin sayfasındaki onay zincirinden ya da birden çok talebi seçip toplu olarak verebilirsiniz. Bir izin talebi onaylandığında izin kaydı ve bakiye kendiliğinden güncellenir.')}
          </InfoNote>
        }
      />

      <NewWorkflowModal open={modalOpen} onClose={() => setModalOpen(false)} />
      {delegating && <DelegationsModal onClose={() => setDelegating(false)} myId={me.employeeId} />}
    </div>
  )
}
