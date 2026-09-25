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
import { workflowApi } from '@/api/workflows'
import { qk, useEmployees, useWorkflow } from '@/api/queries'
import { workflowTypeLabels, type ApprovalStep } from '@/api/types'
import { formatDateTime, formatRelativeToNow, fullName } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ApprovalChain, activeStepId } from './ApprovalChain'
import { DecisionModal } from './DecisionModal'
import { DelegateModal } from './DelegateModal'

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>()
  const { can } = useAuth()
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
      toast.ok(v.decision === 'Approved' ? 'Adım onaylandı' : 'Adım reddedildi')
      setDecision(null)
    },
    onError: (e: unknown) =>
      toast.stop(
        e instanceof Error
          ? e.message
          : 'Karar kaydedilemedi. Sayfayı yenileyip tekrar deneyin.',
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
      toast.ok('Adım devredildi')
      setDelegateStep(null)
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Devretme kaydedilemedi.'),
  })

  if (workflow.isPending) return <CenteredSpinner label="Talep yükleniyor" />

  if (workflow.isError || !workflow.data) {
    return (
      <Panel>
        <ErrorState
          title="Talep bulunamadı"
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
  const title = data.subject || workflowTypeLabels[data.type]

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/onaylar">
          <ArrowLeft className="size-4" />
          Onay kutusu
        </Link>
      </Button>

      <PageHeader
        title={title}
        description={
          isOpen && currentStep
            ? `${currentStep.order}. adımda: ${nameOf(currentStep.approverEmployeeId)} karar veriyor.`
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
            SLA süresi doldu
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Hedef {formatDateTime(data.slaDueAt)} idi, {formatRelativeToNow(data.slaDueAt)}.
          </p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel>
          <PanelHead
            title="Onay zinciri"
            note="Adımlar sırayla işler; önceki karara bağlanmadan sonraki açılmaz"
            action={
              <span className="tabular text-[12px] text-muted-foreground">
                {steps.filter((s) => s.decision !== 'Pending').length}/{steps.length} adım
              </span>
            }
          />
          {steps.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
              Bu talebe onay adımı tanımlanmamış.
            </p>
          ) : (
            <ApprovalChain
              steps={steps}
              nameOf={nameOf}
              canDecide={can('workflow:decide') && isOpen}
              canDelegate={can('workflow:decide') && isOpen}
              onDecide={(step, approve) => setDecision({ step, approve })}
              onDelegate={setDelegateStep}
              busyStepId={decide.isPending ? decision?.step.id : null}
            />
          )}
        </Panel>

        <div className="space-y-4">
          <Panel>
            <PanelHead title="Talep bilgileri" />
            <PanelBody>
              <dl className="divide-y divide-border">
                <div className="flex items-baseline justify-between gap-4 pb-2.5">
                  <dt className="text-[12px] text-muted-foreground">Talep eden</dt>
                  <dd className="text-right text-[13px]">{nameOf(data.requesterEmployeeId)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">Tür</dt>
                  <dd className="text-right text-[13px]">{workflowTypeLabels[data.type]}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-[12px] text-muted-foreground">Açılış</dt>
                  <dd className="tabular text-right text-[13px]">
                    {formatDateTime(data.createdAt)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 pt-2.5">
                  <dt className="text-[12px] text-muted-foreground">SLA hedefi</dt>
                  <dd
                    className={cn(
                      'tabular text-right text-[13px]',
                      late && 'font-semibold text-destructive',
                    )}
                  >
                    {data.slaDueAt ? formatDateTime(data.slaDueAt) : 'Tanımlanmamış'}
                  </dd>
                </div>
              </dl>

              {data.slaDueAt && isOpen && (
                <div className="mt-4 border-t border-border pt-3">
                  <StatusBadge tone={late ? 'danger' : 'neutral'}>
                    {late ? 'Süresi geçti' : `Kalan süre ${formatRelativeToNow(data.slaDueAt)}`}
                  </StatusBadge>
                </div>
              )}
            </PanelBody>
          </Panel>

          {data.payload && (
            <Panel>
              <PanelHead title="Ek veri" />
              <PanelBody>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] whitespace-pre-wrap">
                  {data.payload}
                </pre>
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
