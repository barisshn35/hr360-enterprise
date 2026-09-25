import { useState } from 'react'
import type { CreateAssignmentInput } from '@/api/types'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField, type SelectOption } from '@/components/ui/Field'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format'

/**
 * Sürükle-bırakın klavye / dokunmatik karşılığı. Sürüklemeden farklı olarak
 * unvan ve başlangıç tarihi de değiştirilebilir (ileri tarihli atama).
 */
export function MoveEmployeeModal({
  name,
  currentDeptId,
  currentTitle,
  currentFrom,
  options,
  defaultDate,
  onClose,
  onSubmit,
}: {
  name: string
  currentDeptId: string | null
  currentTitle: string | null
  /** Aktif atamanın başlangıcı — yeni atama bundan önce başlayamaz (backend 400). */
  currentFrom: string | null
  options: SelectOption[]
  defaultDate: string
  onClose: () => void
  onSubmit: (input: CreateAssignmentInput) => void
}) {
  const [departmentId, setDepartmentId] = useState('')
  const [title, setTitle] = useState(currentTitle ?? '')
  const [effectiveFrom, setEffectiveFrom] = useState(
    currentFrom && currentFrom > defaultDate ? currentFrom : defaultDate,
  )
  const [submitted, setSubmitted] = useState(false)

  const errors = {
    department: !departmentId ? 'Hedef departmanı seçin.' : undefined,
    date: !effectiveFrom
      ? 'Başlangıç tarihi gerekli.'
      : currentFrom && effectiveFrom < currentFrom
        ? `Mevcut atama ${formatDate(currentFrom)} tarihinde başlıyor; yeni atama bu tarihten önce başlayamaz.`
        : undefined,
  }

  const submit = () => {
    setSubmitted(true)
    if (errors.department || errors.date) return
    onSubmit({ departmentId, positionTitle: title.trim() || undefined, effectiveFrom })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${name} · departman değiştir`}
      note="Yeni atama eklenir, önceki aktif atama bir gün önce kendiliğinden kapanır; aynı gün yapılan taşımada mevcut atama güncellenir. Geçmiş kayıtlar silinmez."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit}>Taşı</Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label="Yeni departman"
          required
          value={departmentId}
          onChange={setDepartmentId}
          options={options.map((o) => (o.value === currentDeptId ? { ...o, label: `${o.label} (şu anki)`, disabled: true } : o))}
          placeholder="Departman seçin"
          error={submitted ? errors.department : undefined}
        />
        <TextField
          label="Unvan"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          hint="Boş bırakılırsa unvansız atanır."
          maxLength={120}
        />
        <TextField
          label="Başlangıç tarihi"
          type="date"
          required
          value={effectiveFrom}
          min={currentFrom ?? undefined}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          error={submitted || (currentFrom !== null && effectiveFrom < currentFrom) ? errors.date : undefined}
          hint={
            currentFrom && effectiveFrom === currentFrom
              ? 'Mevcut atamayla aynı gün: yeni kayıt açılmaz, mevcut atamanın departmanı ve unvanı güncellenir.'
              : 'İleri bir tarih seçerseniz kişi şemada yeni departmanında, başlangıç tarihiyle görünür.'
          }
          className="sm:w-56"
        />
      </div>
    </Modal>
  )
}
