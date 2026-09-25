import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable'
import { CasePriorityBadge, CaseStatusBadge } from '@/components/ui/ModuleBadges'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { expenseApi } from '@/api/expense'
import { useHrCases } from '@/api/queries'
import {
  caseCategoryLabels,
  casePriorityLabels,
  caseStatusLabels,
  type CaseCategory,
  type CasePriority,
  type CaseStatus,
  type HrCase,
} from '@/api/types'
import { formatRelativeToNow } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'
import { cn } from '@/lib/utils'

const ALL = '__all__'

/** Öncelik, satırın sol kenarındaki çizgiyle de okunur — rozet tek taşıyıcı değil. */
const PRIORITY_EDGE: Record<CasePriority, string> = {
  Low: 'border-transparent',
  Normal: 'border-border',
  High: 'border-[hsl(var(--warning))]',
  Urgent: 'border-destructive',
}

function NewCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<CaseCategory>('Payroll')
  const [priority, setPriority] = useState<CasePriority>('Normal')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      expenseApi.createCase({
        employeeId,
        subject: subject.trim(),
        description: description.trim() || undefined,
        category,
        priority,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      toast.ok('Vaka açıldı')
      onClose()
      setSubject('')
      setDescription('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Vaka açılamadı.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) return setError('Çalışan seçilmeli.')
    if (subject.trim().length < 3) return setError('Konu en az 3 karakter olmalı.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni İK vakası"
      note="Vaka açıldığında İK ekibine düşer; sorumluyu sonra atayabilirsiniz."
      size="lg"
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
            form="new-case"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Vakayı aç
          </Button>
        </>
      }
    >
      <form id="new-case" onSubmit={submit} noValidate className="space-y-4">
        <EmployeePicker
          id="case-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint={error?.includes('Çalışan') ? error : undefined}
        />
        <TextField
          id="case-subject"
          label="Konu"
          required
          value={subject}
          maxLength={200}
          onChange={(e) => setSubject(e.target.value)}
          error={error?.includes('Konu') ? error : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="case-category"
            label="Kategori"
            value={category}
            onChange={(v) => setCategory(v as CaseCategory)}
            options={(Object.keys(caseCategoryLabels) as CaseCategory[]).map((c) => ({
              value: c,
              label: caseCategoryLabels[c],
            }))}
          />
          <SelectField
            id="case-priority"
            label="Öncelik"
            value={priority}
            onChange={(v) => setPriority(v as CasePriority)}
            options={(Object.keys(casePriorityLabels) as CasePriority[]).map((p) => ({
              value: p,
              label: casePriorityLabels[p],
            }))}
          />
        </div>
        <TextAreaField
          id="case-desc"
          label="Açıklama"
          rows={4}
          hint="İsteğe bağlı"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </form>
    </Modal>
  )
}

export function CasesPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState<string>(ALL)
  const [priority, setPriority] = useState<string>(ALL)
  const [modalOpen, setModalOpen] = useState(false)
  const nameOf = useEmployeeName()

  const cases = useHrCases({
    status: status === ALL ? undefined : (status as CaseStatus),
    priority: priority === ALL ? undefined : (priority as CasePriority),
  })

  const filters: TableFilter[] = [
    {
      id: 'status',
      label: 'Durum',
      value: status,
      onChange: setStatus,
      options: [
        { value: ALL, label: 'Tüm durumlar' },
        ...(Object.keys(caseStatusLabels) as CaseStatus[]).map((s) => ({
          value: s,
          label: caseStatusLabels[s],
        })),
      ],
    },
    {
      id: 'priority',
      label: 'Öncelik',
      value: priority,
      onChange: setPriority,
      options: [
        { value: ALL, label: 'Tüm öncelikler' },
        ...(Object.keys(casePriorityLabels) as CasePriority[]).map((p) => ({
          value: p,
          label: casePriorityLabels[p],
        })),
      ],
    },
  ]

  const columns: Array<Column<HrCase>> = [
    {
      id: 'subject',
      header: 'Konu',
      searchText: (c) => `${c.subject} ${caseCategoryLabels[c.category]}`,
      sortValue: (c) => c.subject,
      cell: (c) => (
        <div className={cn('min-w-0 border-l-2 pl-3', PRIORITY_EDGE[c.priority])}>
          <p className="truncate font-medium text-foreground">{c.subject}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {caseCategoryLabels[c.category]}, {formatRelativeToNow(c.createdAt)} açıldı
          </p>
        </div>
      ),
    },
    {
      id: 'employee',
      header: 'Açan',
      hideBelow: 'md',
      searchText: (c) => nameOf(c.employeeId),
      sortValue: (c) => nameOf(c.employeeId),
      exportText: (c) => nameOf(c.employeeId),
      cell: (c) => <span className="text-muted-foreground">{nameOf(c.employeeId)}</span>,
    },
    {
      id: 'assignee',
      header: 'Atanan',
      hideBelow: 'lg',
      sortValue: (c) => (c.assignedToEmployeeId ? nameOf(c.assignedToEmployeeId) : ''),
      exportText: (c) => (c.assignedToEmployeeId ? nameOf(c.assignedToEmployeeId) : '—'),
      cell: (c) => (
        <span className="text-muted-foreground">
          {c.assignedToEmployeeId ? nameOf(c.assignedToEmployeeId) : '—'}
        </span>
      ),
    },
    {
      id: 'priority',
      header: 'Öncelik',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (c) => casePriorityLabels[c.priority] ?? '',
      exportText: (c) => casePriorityLabels[c.priority] ?? '',
      cell: (c) => <CasePriorityBadge priority={c.priority} />,
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (c) => caseStatusLabels[c.status] ?? '',
      exportText: (c) => caseStatusLabels[c.status] ?? '',
      cell: (c) => <CaseStatusBadge status={c.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="İK vakaları"
        description="Çalışanlardan gelen talep, soru ve şikâyetlerin izlendiği kayıt defteri."
        actions={
          can('case:create') && (
            <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
              <Plus className="size-4" />
              Yeni vaka
            </Button>
          )
        }
      />

      <DataTable
        rows={cases.data}
        rowKey={(c) => c.id}
        columns={columns}
        filters={filters}
        isLoading={cases.isPending}
        error={cases.error}
        onRetry={() => void cases.refetch()}
        onRowClick={(c) => navigate(`/panel/ik-vakalari/${c.id}`)}
        searchPlaceholder="Konu, kategori veya kişi ara"
        exportFileName="ik-vakalari"
        pageSize={12}
        emptyTitle="Vaka yok"
        emptyDetail="Bu filtreye uyan vaka bulunmuyor."
        emptyAction={
          can('case:create') ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              Yeni vaka
            </Button>
          ) : undefined
        }
      />

      <NewCaseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
