import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, Check, LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { CenteredSpinner, EmptyState, ErrorState } from '@/components/ui/States'
import { PlanStatusBadge, TaskStatusBadge } from '@/components/ui/ModuleBadges'
import { ProgressBar } from '@/components/ui/Progress'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { onboardingApi } from '@/api/onboarding'
import { useEmployees, useOnboardingPlan } from '@/api/queries'
import {
  taskCategoryLabels,
  type OnboardingTask,
  type OnboardingTaskStatus,
  type TaskCategory,
} from '@/api/types'
import { formatDate, formatNumber, fullName } from '@/lib/format'
import { cn } from '@/lib/utils'

const CATEGORY_ORDER: TaskCategory[] = ['IT', 'HR', 'Facility', 'Training', 'Legal', 'Other']

/** Radix Select boş değer kabul etmiyor; "sorumlu atanmadı" için işaret. */
const UNASSIGNED = '__unassigned__'

function NewTaskModal({
  planId,
  open,
  onClose,
}: {
  planId: string
  open: boolean
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const employees = useEmployees()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<TaskCategory>('IT')
  const [dueDate, setDueDate] = useState('')
  const [assignee, setAssignee] = useState(UNASSIGNED)
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      onboardingApi.addTask(planId, {
        title: title.trim(),
        category,
        dueDate: dueDate || undefined,
        assigneeEmployeeId: assignee === UNASSIGNED ? undefined : assignee,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      toast.ok('Görev eklendi')
      onClose()
      setTitle('')
      setDueDate('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Görev eklenemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim().length < 3) return setError('Görev başlığı en az 3 karakter olmalı.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni görev"
      note="Görev kategorisine göre gruplanır."
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="new-task"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Görevi ekle
          </Button>
        </>
      }
    >
      <form id="new-task" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          id="task-title"
          label="Görev"
          required
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          error={error}
        />
        <SelectField
          id="task-category"
          label="Kategori"
          value={category}
          onChange={(v) => setCategory(v as TaskCategory)}
          options={CATEGORY_ORDER.map((c) => ({ value: c, label: taskCategoryLabels[c] }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="task-due"
            label="Son tarih"
            type="date"
            hint="İsteğe bağlı"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <SelectField
            id="task-assignee"
            label="Sorumlu"
            hint="İsteğe bağlı"
            value={assignee}
            onChange={setAssignee}
            options={[
              { value: UNASSIGNED, label: 'Atanmadı' },
              ...(employees.data ?? []).map((e) => ({ value: e.id, label: fullName(e) })),
            ]}
          />
        </div>
      </form>
    </Modal>
  )
}

/**
 * Görev satırı. Onay kutusuna basınca durum döngüsel ilerler:
 * Bekliyor → Sürüyor → Tamam → Bekliyor. Hareket burada bilgi taşır —
 * tik işareti yerine oturunca görevin bittiği anlaşılır.
 */
function TaskRow({
  task,
  planId,
  canEdit,
}: {
  task: OnboardingTask
  planId: string
  canEdit: boolean
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion()

  const nextStatus: Record<OnboardingTaskStatus, OnboardingTaskStatus> = {
    Pending: 'InProgress',
    InProgress: 'Done',
    Done: 'Pending',
    Blocked: 'InProgress',
  }

  const mutation = useMutation({
    mutationFn: (status: OnboardingTaskStatus) =>
      onboardingApi.setTaskStatus(planId, task.id, status),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
    onError: (e: unknown) =>
      toast.stop(e instanceof Error ? e.message : 'Görev durumu güncellenemedi.'),
  })

  const done = task.status === 'Done'

  return (
    <li className="flex items-start gap-3 py-2.5">
      <button
        type="button"
        disabled={!canEdit || mutation.isPending}
        onClick={() => mutation.mutate(nextStatus[task.status])}
        aria-label={`${task.title} durumunu ilerlet`}
        className={cn(
          'mt-px flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors',
          done
            ? 'border-[hsl(var(--success))] bg-[hsl(var(--success))] text-background'
            : 'border-border bg-background',
          canEdit ? 'cursor-pointer hover:border-primary' : 'cursor-default',
        )}
      >
        {done && (
          <motion.span
            initial={reduced ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <Check aria-hidden="true" className="size-3.5" strokeWidth={3} />
          </motion.span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-[14px] transition-colors',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {task.title}
        </p>
        <p className="tabular mt-0.5 text-[12px] text-muted-foreground">
          {task.dueDate ? `Son tarih ${formatDate(task.dueDate)}` : 'Son tarih yok'}
        </p>
      </div>

      <span className="shrink-0">
        <TaskStatusBadge status={task.status} />
      </span>
    </li>
  )
}

export function OnboardingPlanPage() {
  const { planId } = useParams<{ planId: string }>()
  const { can } = useAuth()
  const plan = useOnboardingPlan(planId)
  const employees = useEmployees({ enabled: can('employee:viewAll') })
  const [taskModal, setTaskModal] = useState(false)

  const tasks = useMemo(() => plan.data?.tasks ?? [], [plan.data])
  const done = tasks.filter((t) => t.status === 'Done').length

  /** Görevler kategoriye göre gruplanır — sorumluluk alanı bir arada okunur. */
  const grouped = useMemo(() => {
    const map = new Map<TaskCategory, OnboardingTask[]>()
    for (const t of tasks) {
      const list = map.get(t.category) ?? []
      list.push(t)
      map.set(t.category, list)
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => ({
      category: c,
      items: map.get(c)!,
    }))
  }, [tasks])

  if (plan.isPending) return <CenteredSpinner label="Plan yükleniyor" />

  if (plan.isError || !plan.data) {
    return (
      <Panel>
        <ErrorState
          title="Plan bulunamadı"
          message={plan.error instanceof Error ? plan.error.message : undefined}
          onRetry={() => void plan.refetch()}
        />
      </Panel>
    )
  }

  const data = plan.data
  const employee = employees.data?.find((e) => e.id === data.employeeId)
  const who = employee ? fullName(employee) : `${data.employeeId.slice(0, 8)}…`
  const canEdit = can('onboarding:manage')

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/onboarding">
          <ArrowLeft className="size-4" />
          Onboarding
        </Link>
      </Button>

      <PageHeader
        title={who}
        description={`${formatDate(data.startDate)} tarihinde başlıyor. ${formatNumber(done)}/${formatNumber(tasks.length)} görev tamam.`}
        actions={
          <>
            <PlanStatusBadge status={data.status} />
            {canEdit && (
              <Button className="cursor-pointer" onClick={() => setTaskModal(true)}>
                <Plus className="size-4" />
                Görev ekle
              </Button>
            )}
          </>
        }
      />

      <Panel>
        <PanelBody>
          <div className="flex items-center gap-4">
            <ProgressBar
              thick
              value={done}
              max={tasks.length || 1}
              tone={done === tasks.length && tasks.length > 0 ? 'success' : 'info'}
              label="Plan ilerlemesi"
            />
            <span className="tabular shrink-0 text-[18px] font-bold">
              %{tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0}
            </span>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Tüm görevler tamamlanınca plan kendiliğinden kapanır.
          </p>
        </PanelBody>
      </Panel>

      {tasks.length === 0 ? (
        <Panel>
          <EmptyState
            title="Görev yok"
            detail="Bu plana henüz görev eklenmemiş."
            action={
              canEdit ? (
                <Button size="sm" className="cursor-pointer" onClick={() => setTaskModal(true)}>
                  İlk görevi ekle
                </Button>
              ) : undefined
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grouped.map((group) => {
            const groupDone = group.items.filter((t) => t.status === 'Done').length
            return (
              <Panel key={group.category}>
                <PanelHead
                  title={taskCategoryLabels[group.category]}
                  action={
                    <span className="tabular text-[12px] text-muted-foreground">
                      {groupDone}/{group.items.length}
                    </span>
                  }
                />
                <PanelBody>
                  <ul className="divide-y divide-border">
                    {group.items.map((t) => (
                      <TaskRow key={t.id} task={t} planId={data.id} canEdit={canEdit} />
                    ))}
                  </ul>
                </PanelBody>
              </Panel>
            )
          })}
        </div>
      )}

      {planId && (
        <NewTaskModal planId={planId} open={taskModal} onClose={() => setTaskModal(false)} />
      )}
    </div>
  )
}
