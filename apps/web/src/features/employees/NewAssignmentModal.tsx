import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { employeeApi } from '@/api/employees'
import { qk, useCompanies } from '@/api/queries'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

interface Errors {
  departmentId?: string
  effectiveFrom?: string
}

export function NewAssignmentModal({
  open,
  onClose,
  employeeId,
}: {
  open: boolean
  onClose: () => void
  employeeId: string
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const companies = useCompanies()

  const [departmentId, setDepartmentId] = useState('')
  const [positionTitle, setPositionTitle] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (!open) {
      setDepartmentId('')
      setPositionTitle('')
      setEffectiveFrom('')
      setErrors({})
      setSubmitted(false)
    }
  }, [open])

  /**
   * Departman adı şirket adıyla birlikte yazılır — iki şirkette de "Satış"
   * varsa kullanıcı hangisini seçtiğini görsün.
   */
  const options = useMemo(
    () =>
      (companies.data ?? []).flatMap((c) =>
        (c.departments ?? []).map((d) => ({ value: d.id, label: `${c.name} — ${d.name}` })),
      ),
    [companies.data],
  )

  const mutation = useMutation({
    mutationFn: () =>
      employeeApi.addAssignment(employeeId, {
        departmentId,
        positionTitle: positionTitle.trim() || undefined,
        effectiveFrom,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.employee(employeeId) })
      void queryClient.invalidateQueries({ queryKey: qk.employees })
      toast.ok('Atama kaydedildi.')
      onClose()
    },
    onError: (e: unknown) => {
      toast.stop(e instanceof Error ? e.message : 'Atama oluşturulamadı.')
    },
  })

  function validate(): Errors {
    const next: Errors = {}
    if (!departmentId) next.departmentId = 'Departman seçilmeli.'
    if (!effectiveFrom) next.effectiveFrom = 'Geçerlilik başlangıcı zorunlu.'
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
        errors.departmentId && { fieldId: 'assignment-department', message: errors.departmentId },
        errors.effectiveFrom && { fieldId: 'assignment-from', message: errors.effectiveFrom },
      ].filter(Boolean) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Departman ataması"
      note="Çalışanı bir departmana ve pozisyona atayın."
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
            form="new-assignment-form"
            className="cursor-pointer"
            disabled={mutation.isPending || options.length === 0}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Atamayı kaydet
          </Button>
        </>
      }
    >
      <form id="new-assignment-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorSummary items={summary} />

        {companies.isPending ? (
          <p className="text-[13px] text-muted-foreground">Departmanlar yükleniyor…</p>
        ) : options.length === 0 ? (
          <p
            role="alert"
            className="rounded-md border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-3 text-[13px] leading-relaxed"
          >
            Atama yapabilmek için önce Organizasyon bölümünden departman tanımlamalısınız.
          </p>
        ) : (
          <SelectField
            id="assignment-department"
            label="Departman"
            required
            value={departmentId}
            onChange={(v) => {
              setDepartmentId(v)
              if (submitted) setErrors(validate())
            }}
            options={options}
            placeholder="Departman seçin"
            error={errors.departmentId}
          />
        )}

        <TextField
          id="assignment-title"
          label="Pozisyon"
          hint="İsteğe bağlı — ör. Yazılım Mühendisi"
          value={positionTitle}
          maxLength={200}
          onChange={(e) => setPositionTitle(e.target.value)}
        />

        <TextField
          id="assignment-from"
          label="Geçerlilik başlangıcı"
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          onBlur={() => submitted && setErrors(validate())}
          error={errors.effectiveFrom}
        />
      </form>
    </Modal>
  )
}
