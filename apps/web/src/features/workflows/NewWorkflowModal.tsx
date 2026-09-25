import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ArrowDown, LoaderCircle, Plus, X } from 'lucide-react'
import { workflowApi } from '@/api/workflows'
import { useEmployees, useMyEmployeeId } from '@/api/queries'
import { useAuth } from '@/auth/useAuth'
import { workflowTypeLabels, type WorkflowType } from '@/api/types'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/Toast'
import { fullName } from '@/lib/format'

interface Errors {
  requester?: string
  approvers?: string
  subject?: string
}

export function NewWorkflowModal({
  open,
  onClose,
  defaultType,
}: {
  open: boolean
  onClose: () => void
  defaultType?: WorkflowType
}) {
  const toast = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const employees = useEmployees()

  const [type, setType] = useState<WorkflowType>(defaultType ?? 'LeaveRequest')
  // İK dışındakiler yalnızca kendi adlarına talep açabilir (backend 403 döner).
  const { roles } = useAuth()
  const isHr = roles.some((r) => r === 'hr-admin' || r === 'tenant-admin' || r === 'platform-admin')
  const me = useMyEmployeeId(!isHr)
  const [pickedRequester, setRequester] = useState('')
  const requester = isHr ? pickedRequester : (me.employeeId ?? '')
  const [subject, setSubject] = useState('')
  const [payload, setPayload] = useState('')
  const [slaHours, setSlaHours] = useState('48')
  const [approvers, setApprovers] = useState<string[]>([])
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!open) {
      setType(defaultType ?? 'LeaveRequest')
      setRequester('')
      setSubject('')
      setPayload('')
      setSlaHours('48')
      setApprovers([])
      setErrors({})
      setSubmitted(false)
    }
  }, [open, defaultType])

  const people = employees.data ?? []
  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of people) map.set(e.id, fullName(e))
    return map
  }, [people])

  const availableApprovers = people.filter((e) => e.id !== requester && !approvers.includes(e.id))

  const mutation = useMutation({
    mutationFn: () =>
      workflowApi.create({
        type,
        requesterEmployeeId: requester,
        subject: subject.trim() || undefined,
        payload: payload.trim() || undefined,
        approverEmployeeIds: approvers,
        slaHours: slaHours ? Number(slaHours) : undefined,
      }),
    onSuccess: (workflow) => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
      toast.ok('Onay talebi oluşturuldu.')
      onClose()
      navigate(`/panel/onaylar/${workflow.id}`)
    },
    onError: (e: unknown) => {
      toast.stop(e instanceof Error ? e.message : 'Talep oluşturulamadı.')
    },
  })

  function validate(): Errors {
    const next: Errors = {}
    if (!requester) next.requester = 'Talep eden çalışan seçilmeli.'
    if (approvers.length === 0) next.approvers = 'En az bir onaycı eklenmeli.'
    if (subject.trim().length > 0 && subject.trim().length < 3)
      next.subject = 'Konu en az 3 karakter olmalı.'
    return next
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length === 0) mutation.mutate()
  }

  const summary: SummaryItem[] = submitted
    ? ([
        errors.requester && { fieldId: 'workflow-requester', message: errors.requester },
        errors.subject && { fieldId: 'workflow-subject', message: errors.subject },
        errors.approvers && { fieldId: 'workflow-approver-picker', message: errors.approvers },
      ].filter(Boolean) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni onay talebi"
      note="Onaycıları eklediğiniz sırayla zincir oluşturulur."
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
            form="new-workflow-form"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Talebi oluştur
          </Button>
        </>
      }
    >
      <form id="new-workflow-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorSummary items={summary} />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="workflow-type"
            label="Talep türü"
            required
            value={type}
            onChange={(v) => setType(v as WorkflowType)}
            options={(Object.keys(workflowTypeLabels) as WorkflowType[]).map((t) => ({
              value: t,
              label: workflowTypeLabels[t],
            }))}
          />

          <TextField
            id="workflow-sla"
            label="SLA (saat)"
            type="number"
            min={1}
            max={720}
            value={slaHours}
            hint="Karar için hedef süre"
            className="tabular"
            onChange={(e) => setSlaHours(e.target.value)}
          />
        </div>

        {isHr ? (
          <SelectField
            id="workflow-requester"
            label="Talep eden"
            required
            value={requester}
            onChange={(v) => {
              setRequester(v)
              setApprovers((prev) => prev.filter((id) => id !== v))
              if (submitted) setErrors(validate())
            }}
            options={people.map((e) => ({ value: e.id, label: `${fullName(e)} — ${e.email}` }))}
            placeholder="Çalışan seçin"
            error={errors.requester}
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {me.notLinked
              ? 'Hesabınıza bağlı çalışan kaydı bulunamadı; talep açamazsınız.'
              : 'Talep sizin adınıza oluşturulacak.'}
          </p>
        )}

        <TextField
          id="workflow-subject"
          label="Konu"
          value={subject}
          maxLength={200}
          hint="İsteğe bağlı — boş bırakılırsa talep türü kullanılır."
          onChange={(e) => setSubject(e.target.value)}
          onBlur={() => submitted && setErrors(validate())}
          error={errors.subject}
        />

        {/* Onay zinciri: sıra anlamlı olduğu için ekleme sırası korunur */}
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">
            Onay zinciri
            <span className="ml-1 font-normal text-muted-foreground">zorunlu</span>
          </span>

          {approvers.length > 0 && (
            <ol className="space-y-1.5">
              {approvers.map((id, index) => (
                <li key={id} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                    <span
                      aria-hidden="true"
                      className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {nameOf.get(id) ?? id}
                    </span>
                    <button
                      type="button"
                      onClick={() => setApprovers((prev) => prev.filter((a) => a !== id))}
                      aria-label={`${nameOf.get(id) ?? 'Onaycı'} adımını kaldır`}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                  {index < approvers.length - 1 && (
                    <ArrowDown aria-hidden="true" className="ml-3 size-3.5 shrink-0 text-muted-foreground" />
                  )}
                </li>
              ))}
            </ol>
          )}

          <div className="flex gap-2">
            <Select
              value=""
              onValueChange={(v) => {
                if (v) setApprovers((prev) => [...prev, v])
              }}
              disabled={availableApprovers.length === 0}
            >
              <SelectTrigger
                id="workflow-approver-picker"
                className="min-w-0 flex-1"
                aria-label="Onaycı ekle"
                aria-invalid={errors.approvers ? true : undefined}
                aria-describedby={errors.approvers ? 'workflow-approver-error' : undefined}
              >
                <SelectValue
                  placeholder={
                    availableApprovers.length === 0
                      ? 'Eklenebilecek başka çalışan yok'
                      : 'Onaycı ekle…'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availableApprovers.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {fullName(e)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span
              aria-hidden="true"
              className="tabular flex h-9 items-center gap-1 rounded-md border border-border px-3 text-[12px] font-medium text-muted-foreground"
            >
              <Plus className="size-3.5" />
              {approvers.length} adım
            </span>
          </div>

          {errors.approvers && (
            <p id="workflow-approver-error" role="alert" className="text-[12px] text-destructive">
              {errors.approvers}
            </p>
          )}
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Adımlar bu sırayla işler; önceki adım karara bağlanmadan sonraki adım açılmaz.
          </p>
        </div>

        <TextAreaField
          id="workflow-payload"
          label="Ek veri"
          rows={3}
          value={payload}
          maxLength={4000}
          hint="İsteğe bağlı — serbest metin veya JSON."
          onChange={(e) => setPayload(e.target.value)}
        />
      </form>
    </Modal>
  )
}
