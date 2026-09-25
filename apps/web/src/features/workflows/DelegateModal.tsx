import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { ApprovalStep } from '@/api/types'
import { useEmployees } from '@/api/queries'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField } from '@/components/ui/Field'
import { fullName } from '@/lib/format'

export function DelegateModal({
  step,
  onClose,
  onConfirm,
  pending,
}: {
  step: ApprovalStep | null
  onClose: () => void
  onConfirm: (delegateToEmployeeId: string, comment?: string) => void
  pending: boolean
}) {
  const employees = useEmployees()
  const [target, setTarget] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!step) {
      setTarget('')
      setComment('')
      setError(undefined)
    }
  }, [step])

  // Adımın mevcut onaycısı devir hedefi olarak seçilemez.
  const candidates = useMemo(
    () =>
      (employees.data ?? [])
        .filter((e) => e.id !== step?.approverEmployeeId)
        .map((e) => ({ value: e.id, label: `${fullName(e)} — ${e.email}` })),
    [employees.data, step],
  )

  if (!step) return null

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target) {
      setError('Devredilecek çalışanı seçin.')
      return
    }
    setError(undefined)
    onConfirm(target, comment.trim() || undefined)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Adımı devret"
      note={`${step.order}. onay adımını başka bir çalışana devredin.`}
      footer={
        <>
          <Button variant="outline" className="cursor-pointer" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="delegate-form"
            className="cursor-pointer"
            disabled={pending || candidates.length === 0}
          >
            {pending && <LoaderCircle className="size-4 animate-spin" />}
            Devret
          </Button>
        </>
      }
    >
      <form id="delegate-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        {employees.isPending ? (
          <p className="text-[13px] text-muted-foreground">Çalışanlar yükleniyor…</p>
        ) : candidates.length === 0 ? (
          <p
            role="alert"
            className="rounded-md border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/10 p-3 text-[13px]"
          >
            Devredilebilecek başka çalışan kaydı bulunamadı.
          </p>
        ) : (
          <SelectField
            id="delegate-target"
            label="Devredilecek çalışan"
            required
            value={target}
            onChange={setTarget}
            options={candidates}
            error={error}
          />
        )}

        <TextAreaField
          id="delegate-comment"
          label="Açıklama"
          rows={3}
          value={comment}
          maxLength={1000}
          hint="İsteğe bağlı. Devir gerekçesi denetim izinde görünür."
          onChange={(e) => setComment(e.target.value)}
        />
      </form>
    </Modal>
  )
}
