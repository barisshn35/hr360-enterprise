import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { PlanStatusBadge } from '@/components/ui/ModuleBadges'
import { ProgressBar } from '@/components/ui/Progress'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { onboardingApi } from '@/api/onboarding'
import { useEmployees, useOnboardingPlans } from '@/api/queries'
import { planStatusLabels, type OnboardingPlan, type PlanStatus } from '@/api/types'
import { formatDate, fullName } from '@/lib/format'

type TabKey = PlanStatus | 'all'

const TABS: Array<TabDef<TabKey>> = [
  { key: 'InProgress', label: 'Sürüyor' },
  { key: 'NotStarted', label: 'Başlamadı' },
  { key: 'Completed', label: 'Tamamlandı' },
  { key: 'all', label: 'Tümü' },
]

/** Tamamlanan görev oranı — plan listesinde tek bakışta ilerleme. */
function planProgress(plan: OnboardingPlan) {
  const tasks = plan.tasks ?? []
  return { done: tasks.filter((t) => t.status === 'Done').length, total: tasks.length }
}

function NewPlanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [useDefaultTasks, setUseDefaultTasks] = useState(true)
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      onboardingApi.createPlan({
        employeeId,
        startDate,
        templateName: templateName.trim() || undefined,
        useDefaultTasks,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      toast.ok(useDefaultTasks ? 'Plan oluşturuldu, standart görevler eklendi' : 'Plan oluşturuldu')
      onClose()
      setStartDate('')
      setTemplateName('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Plan oluşturulamadı.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) return setError('Çalışan seçilmeli.')
    if (!startDate) return setError('Başlangıç tarihi zorunlu.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni onboarding planı"
      note="Plan açıldığında görevler kategori kategori takip edilir."
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
            form="new-plan"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Planı oluştur
          </Button>
        </>
      }
    >
      <form id="new-plan" onSubmit={submit} noValidate className="space-y-4">
        <EmployeePicker
          id="plan-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint={error?.includes('Çalışan') ? error : 'Plan bu çalışan için açılır.'}
        />

        <TextField
          id="plan-start"
          label="İşe başlama tarihi"
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          error={error?.includes('Başlangıç') ? error : undefined}
        />

        <TextField
          id="plan-template"
          label="Şablon adı"
          hint="İsteğe bağlı. Örn. Yazılım ekibi."
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
        />

        <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={useDefaultTasks}
            onCheckedChange={(v) => setUseDefaultTasks(v === true)}
            className="mt-0.5"
          />
          <span className="text-[13px]">
            Standart görevleri otomatik oluştur
            <span className="block text-[12px] text-muted-foreground">
              Hazır görev seti eklenir; sonra düzenleyebilirsiniz.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}

export function OnboardingPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useTabParam<TabKey>('durum', 'InProgress')
  const [modalOpen, setModalOpen] = useState(false)
  const plans = useOnboardingPlans({ status: tab === 'all' ? undefined : tab })
  const employees = useEmployees({ enabled: can('employee:viewAll') })

  const canManage = can('onboarding:manage')

  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees.data ?? []) map.set(e.id, fullName(e))
    return (id: string) => map.get(id) ?? `${id.slice(0, 8)}…`
  }, [employees.data])

  const columns: Array<Column<OnboardingPlan>> = [
    {
      id: 'employee',
      header: 'Çalışan',
      searchText: (p) => `${nameOf(p.employeeId)} ${p.templateName ?? ''}`,
      sortValue: (p) => nameOf(p.employeeId),
      exportText: (p) => nameOf(p.employeeId),
      cell: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{nameOf(p.employeeId)}</p>
          {p.templateName && (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{p.templateName}</p>
          )}
        </div>
      ),
    },
    {
      id: 'startDate',
      header: 'Başlangıç',
      hideBelow: 'sm',
      sortValue: (p) => new Date(p.startDate).getTime(),
      exportText: (p) => formatDate(p.startDate),
      cell: (p) => <span className="tabular text-muted-foreground">{formatDate(p.startDate)}</span>,
    },
    {
      id: 'progress',
      header: 'İlerleme',
      hideBelow: 'md',
      sortValue: (p) => {
        const { done, total } = planProgress(p)
        return total > 0 ? done / total : 0
      },
      exportText: (p) => {
        const { done, total } = planProgress(p)
        return `${done}/${total}`
      },
      cell: (p) => {
        const { done, total } = planProgress(p)
        if (total === 0) return <span className="text-muted-foreground">Görev yok</span>
        return (
          <div className="flex min-w-32 items-center gap-3">
            <ProgressBar
              value={done}
              max={total}
              tone={done === total ? 'success' : 'info'}
              label={`${nameOf(p.employeeId)} görev ilerlemesi`}
            />
            <span className="tabular shrink-0 text-[12px] text-muted-foreground">
              {done}/{total}
            </span>
          </div>
        )
      },
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (p) => planStatusLabels[p.status] ?? '',
      exportText: (p) => planStatusLabels[p.status] ?? '',
      cell: (p) => <PlanStatusBadge status={p.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Onboarding"
        description="İşe yeni başlayanların görev planları ve ilerlemeleri."
        actions={
          canManage && (
            <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
              <Plus className="size-4" />
              Yeni plan
            </Button>
          )
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Plan durumu" />

      <DataTable
        rows={plans.data}
        rowKey={(p) => p.id}
        columns={columns}
        isLoading={plans.isPending}
        error={plans.error}
        onRetry={() => void plans.refetch()}
        onRowClick={(p) => navigate(`/panel/onboarding/${p.id}`)}
        searchPlaceholder="Çalışan veya şablon ara"
        exportFileName="onboarding-planlari"
        emptyTitle="Bu durumda plan yok"
        emptyDetail="Yeni bir çalışan için plan açtığınızda burada görünür."
        emptyAction={
          canManage ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              Yeni plan
            </Button>
          ) : undefined
        }
      />

      <NewPlanModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
