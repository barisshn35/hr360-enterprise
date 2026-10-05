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
import { useMyEmployeeId, useOverdueWorkflows, useWorkflows } from '@/api/queries'
import { useDirectory } from '@/api/directory'
import { useConfirm } from '@/components/ui/Confirm'
import { Modal } from '@/components/ui/Modal'
import { TextAreaField } from '@/components/ui/Field'
import { workflowApi } from '@/api/workflows'
import { useAction } from '@/features/shared/kit'
import { DelegationsModal } from './DelegationsModal'
import {
  workflowStatusLabels,
  workflowTypeLabels,
  type Workflow,
  type WorkflowStatus,
} from '@/api/types'
import { formatDate, formatRelativeToNow } from '@/lib/format'
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
  // Ad çözümlemesi herkesin erişebildiği dizinden (tam çalışan listesi çalışan rolüne 403 döner).
  const directory = useDirectory()

  const query = isOverdueTab ? overdue : list

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of directory.data ?? []) map.set(e.id, e.fullName)
    return map
  }, [directory.data])

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
  const bulk = useAction(({ ids, approve, comment }: { ids: string[]; approve: boolean; comment?: string }) => {
    const items = rows.filter((w) => ids.includes(w.id)).flatMap((w) => { const st = myStep(w); return st ? [{ workflowId: w.id, stepId: st.id }] : [] })
    return workflowApi.bulkDecide(items, approve ? 'Approved' : 'Rejected', comment)
  }, {
    success: (r) => tx('{0} talep karara bağlandı', [r.done]) + (r.results.length > r.done ? ' · ' + tx('{0} talep atlandı', [r.results.length - r.done]) : ''),
    invalidate: [['workflows']],
  })
  // Toplu karar geri alınamaz: onayda kaç talep olduğu sorulur; rette (tekil retteki gibi)
  // talep sahiplerinin göreceği gerekçe zorunludur.
  const confirm = useConfirm()
  const [rejecting, setRejecting] = useState<{ ids: string[]; n: number } | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectError, setRejectError] = useState<string | undefined>()
  const askBulkApprove = async (ids: string[], n: number) => {
    if (await confirm({
      title: tx('{0} talep onaylansın mı?', [n]),
      note: tx('Seçtiğiniz taleplerde sırası size gelmiş adımlar onaylanır. Bu işlem geri alınamaz.'),
      action: tx('Toplu onayla'),
      destructive: false,
    })) bulk.mutate({ ids, approve: true })
  }
  const submitBulkReject = () => {
    if (!rejecting) return
    const reason = rejectReason.trim()
    if (reason.length < 3) {
      setRejectError(tx('Ret gerekçesi zorunlu (en az 3 karakter).'))
      return
    }
    bulk.mutate({ ids: rejecting.ids, approve: false, comment: reason }, {
      onSuccess: () => { setRejecting(null); setRejectReason(''); setRejectError(undefined) },
    })
  }

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
          {/* Dar ekranda (390px) talep eden ve durum sütunları sığmıyor: burada gösterilir. */}
          <div className="mt-1 flex flex-wrap items-center gap-2 md:hidden">
            <WorkflowStatusBadge status={w.status} />
            <span className="truncate text-[12px] text-muted-foreground">{nameOf(w.requesterEmployeeId)}</span>
          </div>
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
      // Ekranla aynı: SLA'sız talepte "—".
      exportText: (w) => (w.slaDueAt ? formatDate(w.slaDueAt) : '—'),
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
      hideBelow: 'md',
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
              <Button size="sm" disabled={!n || bulk.isPending} onClick={() => void askBulkApprove(ids, n)}><Check className="size-4" /> {tx('Toplu onayla')}</Button>
              <Button size="sm" variant="outline" disabled={!n || bulk.isPending} onClick={() => { setRejectReason(''); setRejectError(undefined); setRejecting({ ids, n }) }}><X className="size-4" /> {tx('Toplu reddet')}</Button>
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
            {can('workflow:decide')
              ? tx('Kararı talebin sayfasındaki onay zincirinden ya da birden çok talebi seçip toplu olarak verebilirsiniz. Bir izin talebi onaylandığında izin kaydı ve bakiye kendiliğinden güncellenir.')
              : tx('Açtığınız ve onaycısı olduğunuz talepler burada listelenir. Ayrıntı ve onay zinciri için talebe tıklayın.')}
          </InfoNote>
        }
      />

      <Modal
        open={rejecting !== null}
        onClose={() => !bulk.isPending && setRejecting(null)}
        title={tx('{0} talep reddedilsin mi?', [rejecting?.n ?? 0])}
        note={tx('Gerekçe tüm talep sahiplerine gösterilir ve onay geçmişine yazılır.')}
        footer={
          <>
            <Button variant="outline" onClick={() => setRejecting(null)} disabled={bulk.isPending}>{tx('Vazgeç')}</Button>
            <Button type="submit" form="bulk-reject-form" variant="destructive" disabled={bulk.isPending}>{tx('Toplu reddet')}</Button>
          </>
        }
      >
        <form id="bulk-reject-form" noValidate onSubmit={(e) => { e.preventDefault(); submitBulkReject() }}>
          <TextAreaField
            id="bulk-reject-reason"
            label={tx('Gerekçe')}
            required
            rows={4}
            value={rejectReason}
            maxLength={1000}
            hint={tx('Zorunlu. Talep sahibi bu gerekçeyi görür.')}
            onChange={(e) => setRejectReason(e.target.value)}
            error={rejectError}
          />
        </form>
      </Modal>

      <NewWorkflowModal open={modalOpen} onClose={() => setModalOpen(false)} />
      {delegating && <DelegationsModal onClose={() => setDelegating(false)} myId={me.employeeId} />}
    </div>
  )
}
