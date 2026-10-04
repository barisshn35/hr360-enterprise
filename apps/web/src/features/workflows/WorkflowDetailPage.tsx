import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { WorkflowStatusBadge } from '@/components/ui/ModuleBadges'
import { CenteredSpinner, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { isHr } from '@/auth/roles'
import { workflowApi } from '@/api/workflows'
import { qk, useEmployees, useWorkflow, useMyEmployeeId } from '@/api/queries'
import { workflowTypeLabels, type ApprovalStep } from '@/api/types'
import { formatDate, formatDateTime, formatNumber, formatRelativeToNow, fullName } from '@/lib/format'
import { leaveTypeLabels, type LeaveType } from '@/api/leave'
import { cn } from '@/lib/utils'
import { ApprovalChain, activeStepId } from './ApprovalChain'
import { DecisionModal } from './DecisionModal'
import { DelegateModal } from './DelegateModal'
import { tx } from '@/lib/i18n'

/** Talep yükündeki bilinen anahtarların okunur adları (İK'nın "Ek veri" listesi için). */
const PAYLOAD_LABELS: Record<string, string> = {
  type: tx('Tür'),
  startDate: tx('Başlangıç'),
  endDate: tx('Bitiş'),
  date: tx('Tarih'),
  days: tx('Gün'),
  hours: tx('Saat'),
  amount: tx('Tutar'),
  totalAmount: tx('Toplam tutar'),
  currency: tx('Para birimi'),
  category: tx('Kategori'),
  position: tx('Pozisyon'),
  candidate: tx('Aday'),
  grossSalary: tx('Brüt ücret'),
  expiresAt: tx('Geçerlilik sonu'),
  reason: tx('Gerekçe'),
}
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/

function parsePayload(payload: string | null | undefined): Record<string, unknown> | null {
  if (!payload) return null
  try {
    const v: unknown = JSON.parse(payload)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Yükü okunur anahtar-değer listesine çevirir; kimlikler (…Id, GUID) gösterilmez. */
function payloadRows(p: Record<string, unknown>, skip: string[]): Array<{ key: string; label: string; value: string }> {
  const rows: Array<{ key: string; label: string; value: string }> = []
  for (const [key, raw] of Object.entries(p)) {
    if (skip.includes(key) || raw === null || raw === undefined || raw === '') continue
    if (/id$/i.test(key) || (typeof raw === 'string' && GUID_RE.test(raw))) continue
    let value: string
    if (typeof raw === 'number') value = formatNumber(raw)
    else if (typeof raw === 'boolean') value = raw ? tx('Evet') : tx('Hayır')
    else if (typeof raw === 'string')
      value =
        key === 'type' && raw in leaveTypeLabels
          ? leaveTypeLabels[raw as LeaveType]
          : ISO_DATE_RE.test(raw)
            ? raw.length > 10 ? formatDateTime(raw) : formatDate(raw)
            : raw
    else value = JSON.stringify(raw)
    rows.push({ key, label: PAYLOAD_LABELS[key] ?? key, value })
  }
  return rows
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const { can, roles } = useAuth()
  const { employeeId: myEmployeeId } = useMyEmployeeId()
  const toast = useToast()
  const queryClient = useQueryClient()

  const workflow = useWorkflow(workflowId)
  const employees = useEmployees({ enabled: can('employee:viewAll') })

  const [decision, setDecision] = useState<{ step: ApprovalStep; approve: boolean } | null>(null)
  const [delegateStep, setDelegateStep] = useState<ApprovalStep | null>(null)

  const employeeNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees.data ?? []) map.set(e.id, fullName(e))
    return map
  }, [employees.data])

  const nameOf = (id: string | null | undefined) =>
    (id && employeeNames.get(id)) || (id ? `${id.slice(0, 8)}…` : '—')

  const steps = useMemo(
    () => [...(workflow.data?.steps ?? [])].sort((a, b) => a.order - b.order),
    [workflow.data],
  )

  const invalidate = () => {
    if (workflowId) void queryClient.invalidateQueries({ queryKey: qk.workflow(workflowId) })
    void queryClient.invalidateQueries({ queryKey: ['workflows'] })
    // Onay, izin ve bildirim tarafını Kafka üzerinden tetikliyor — o listeler de tazelensin.
    void queryClient.invalidateQueries({ queryKey: ['leave'] })
    void queryClient.invalidateQueries({ queryKey: ['notification'] })
  }

  const decide = useMutation({
    mutationFn: (v: { stepId: string; decision: 'Approved' | 'Rejected'; comment?: string }) =>
      workflowApi.decide(workflowId!, v.stepId, { decision: v.decision, comment: v.comment }),
    onSuccess: (_, v) => {
      invalidate()
      toast.ok(v.decision === 'Approved' ? tx('Adım onaylandı') : tx('Adım reddedildi'))
      setDecision(null)
    },
    onError: (e: unknown) =>
      toast.stop(
        e instanceof Error
          ? e.message
          : tx('Karar kaydedilemedi. Sayfayı yenileyip tekrar deneyin.'),
      ),
  })

  const delegate = useMutation({
    mutationFn: (v: { stepId: string; delegateToEmployeeId: string; comment?: string }) =>
      workflowApi.delegate(workflowId!, v.stepId, {
        delegateToEmployeeId: v.delegateToEmployeeId,
        comment: v.comment,
      }),
    onSuccess: () => {
      invalidate()
      toast.ok(tx('Adım devredildi'))
      setDelegateStep(null)
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : tx('Devretme kaydedilemedi.')),
  })

  if (workflow.isPending) return <CenteredSpinner label={tx('Talep yükleniyor')} />

  if (workflow.isError || !workflow.data) {
    return (
      <Panel>
        <ErrorState
          title={tx('Talep bulunamadı')}
          message={workflow.error instanceof Error ? workflow.error.message : undefined}
          onRetry={() => void workflow.refetch()}
        />
      </Panel>
    )
  }

  const data = workflow.data
  const late = data.slaDueAt ? new Date(data.slaDueAt).getTime() < Date.now() : false
  const isOpen = data.status === 'Pending'
  const currentStep = steps.find((s) => s.id === activeStepId(steps))
  // Backend kuralları: talep sahibi kendi talebine karar veremez; İK dışındakiler
  // yalnızca kendilerine (ya da vekil olarak kendilerine devredilmiş) adıma karar
  // verir ve yalnızca kendi adımlarını devredebilir.
  const hr = isHr(roles)
  const isRequester = Boolean(myEmployeeId) && data.requesterEmployeeId === myEmployeeId
  const myStep =
    Boolean(myEmployeeId) &&
    (currentStep?.approverEmployeeId === myEmployeeId || currentStep?.delegatedToEmployeeId === myEmployeeId)
  // Akış tanımı (belirli kişi) ya da vekâletle yönetici olmayan biri de onaycı/vekil olabilir:
  // kendi adımı varsa rolüne bakılmaksızın karar verebilir (backend aynı kuralla denetler).
  const canDecide = isOpen && Boolean(myEmployeeId) && !isRequester && ((hr && can('workflow:decide')) || Boolean(myStep))
  const canDelegate =
    can('workflow:decide') && isOpen && (hr || (Boolean(myEmployeeId) && currentStep?.approverEmployeeId === myEmployeeId))
  const title = data.subject || workflowTypeLabels[data.type]
  // Gerekçe onaycıya ve İK'ya gösterilir; akış tanımında gizlenmişse sunucu onaycıya döndürmez.
  const payload = parsePayload(data.payload)
  const reason = typeof payload?.reason === 'string' && payload.reason.trim() ? payload.reason.trim() : null
  const extraRows = hr && payload ? payloadRows(payload, ['reason']) : []

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/onaylar">
          <ArrowLeft className="size-4" />
          {tx('Onay kutusu')}
        </Link>
      </Button>

      <PageHeader
        title={title}
        description={
          isOpen && currentStep
            ? tx('{0}. adımda: {1} karar veriyor.', [currentStep.order, nameOf(currentStep.approverEmployeeId)])
            : undefined
        }
        actions={<WorkflowStatusBadge status={data.status} />}
      />

      {late && isOpen && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-[14px] font-semibold text-destructive">
            <TriangleAlert aria-hidden="true" className="size-4" />
            {tx('SLA süresi doldu')}
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{tx('Hedef {0} idi, {1}.', [formatDateTime(data.slaDueAt), formatRelativeToNow(data.slaDueAt)])}</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHead
            title={tx('Onay zinciri')}
            note={tx('Adımlar sırayla işler; önceki karara bağlanmadan sonraki açılmaz')}
            action={
              <span className="tabular text-[12px] text-muted-foreground">
                {tx('{0}/{1} adım', [steps.filter((s) => s.decision !== 'Pending').length, steps.length])}</span>
            }
          />
          {steps.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              {tx('Bu talebe onay adımı tanımlanmamış.')}
            </p>
          ) : (
            <ApprovalChain
              steps={steps}
              nameOf={nameOf}
              canDecide={canDecide}
              canDelegate={canDelegate}
              onDecide={(step, approve) => setDecision({ step, approve })}
              onDelegate={setDelegateStep}
              busyStepId={decide.isPending ? decision?.step.id : null}
            />
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHead title={tx('Talep bilgileri')} />
            <PanelBody>
              <dl className="divide-y divide-border">
                <div className="flex items-baseline justify-between gap-4 pb-2.5">
                  <dt className="text-[12px] text-muted-foreground">{tx('Talep eden')}</dt>
                  <dd className="text-right text-[13px]">{nameOf(data.requesterEmployeeId)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">{tx('Tür')}</dt>
                  <dd className="text-right text-[13px]">{workflowTypeLabels[data.type]}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">{tx('Açılış')}</dt>
                  <dd className="tabular text-right text-[13px]">
                    {formatDateTime(data.createdAt)}
                  </dd>
                </div>
                <div className={cn('flex items-baseline justify-between gap-4', reason ? 'py-2.5' : 'pt-2.5')}>
                  <dt className="text-[12px] text-muted-foreground">{tx('SLA hedefi')}</dt>
                  <dd
                    className={cn(
                      'tabular text-right text-[13px]',
                      late && 'font-semibold text-destructive',
                    )}
                  >
                    {data.slaDueAt ? formatDateTime(data.slaDueAt) : tx('Tanımlanmamış')}
                  </dd>
                </div>
                {reason && (
                  <div className="pt-2.5">
                    <dt className="text-[12px] text-muted-foreground">{tx('Gerekçe')}</dt>
                    <dd className="mt-1 text-[13px] leading-relaxed break-words whitespace-pre-wrap">{reason}</dd>
                  </div>
                )}
              </dl>

              {data.slaDueAt && isOpen && (
                <div className="mt-4 border-t border-border pt-3">
                  <StatusBadge tone={late ? 'danger' : 'neutral'}>
                    {late ? tx('Süresi geçti') : tx('Kalan süre {0}', [formatRelativeToNow(data.slaDueAt)])}
                  </StatusBadge>
                </div>
              )}
            </PanelBody>
          </Panel>

          {/* Ham yük (JSON) çalışana gösterilmez; İK okunur liste görür, kimlikler gizlenir. */}
          {extraRows.length > 0 && (
            <Panel>
              <PanelHead title={tx('Ek veri')} />
              <PanelBody>
                <dl className="divide-y divide-border">
                  {extraRows.map((r) => (
                    <div key={r.key} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
                      <dt className="text-[12px] text-muted-foreground">{r.label}</dt>
                      <dd className="tabular text-right text-[13px] break-words">{r.value}</dd>
                    </div>
                  ))}
                </dl>
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>

      <DecisionModal
        state={decision}
        onClose={() => setDecision(null)}
        pending={decide.isPending}
        onConfirm={(comment) => {
          if (!decision) return
          decide.mutate({
            stepId: decision.step.id,
            decision: decision.approve ? 'Approved' : 'Rejected',
            comment,
          })
        }}
      />

      <DelegateModal
        step={delegateStep}
        requesterEmployeeId={data.requesterEmployeeId}
        onClose={() => setDelegateStep(null)}
        pending={delegate.isPending}
        onConfirm={(delegateToEmployeeId, comment) => {
          if (!delegateStep) return
          delegate.mutate({ stepId: delegateStep.id, delegateToEmployeeId, comment })
        }}
      />
    </div>
  )
}
