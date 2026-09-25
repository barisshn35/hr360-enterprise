import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { leaveApi } from '@/api/leave'
import { useLeaveBalances } from '@/api/queries'
import { leaveTypeLabels, type LeaveType } from '@/api/types'
import { formatNumber } from '@/lib/format'

interface Errors {
  employeeId?: string
  dates?: string
  days?: string
}

/** Bitiş dahil, gün farkı. Hafta sonu/tatil hesabı backend'in işi. */
function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0
  const a = new Date(start).getTime()
  const b = new Date(end).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.round((b - a) / 86_400_000) + 1
}

export function NewLeaveRequestModal({
  open,
  onClose,
  defaultEmployeeId = '',
}: {
  open: boolean
  onClose: () => void
  defaultEmployeeId?: string
}) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [employeeId, setEmployeeId] = useState(defaultEmployeeId)
  const [type, setType] = useState<LeaveType>('Annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) {
      setEmployeeId(defaultEmployeeId)
    } else {
      setType('Annual')
      setStartDate('')
      setEndDate('')
      setReason('')
      setErrors({})
      setSubmitted(false)
    }
  }, [open, defaultEmployeeId])

  const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear()
  const balances = useLeaveBalances(employeeId || undefined, year, Boolean(employeeId))

  const days = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate])
  const balance = balances.data?.find((b) => b.type === type)
  /** Yetersiz bakiye engel değil uyarıdır — son kararı backend verir. */
  const shortfall = balance ? days - balance.remainingDays : 0

  const mutation = useMutation({
    mutationFn: () =>
      leaveApi.createRequest({
        employeeId,
        type,
        startDate,
        endDate,
        days,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] })
      toast.ok('İzin talebi oluşturuldu, onay zincirine gönderildi')
      onClose()
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Talep oluşturulamadı.'),
  })

  function validate(overrideEmployeeId?: string): Errors {
    const next: Errors = {}
    if (!(overrideEmployeeId ?? employeeId)) next.employeeId = 'Çalışan seçilmeli.'
    if (!startDate || !endDate) {
      next.dates = 'Başlangıç ve bitiş tarihi zorunlu.'
    } else if (new Date(endDate) < new Date(startDate)) {
      next.dates = 'Bitiş tarihi başlangıçtan önce olamaz.'
    } else if (days <= 0) {
      // Yalnızca tarihler doluyken ve aralık ters değilken anlamlı - aksi
      // halde yukarıdaki iki kural zaten aynı kök sebep (eksik/geçersiz
      // tarih) için ikinci, gereksiz bir hata satırı daha üretiyordu.
      next.days = 'Gün sayısı hesaplanamadı, tarihleri kontrol edin.'
    }
    return next
  }

  /** EmployeePicker'ın kendi onBlur'u yok; seçim değiştiğinde de (yalnızca
   * bir kez gönderim denendiyse) özet/inline hatalar güncellensin diye
   * doğrudan burada tetikliyoruz. State henüz güncellenmediği için
   * validate'e yeni değeri parametre olarak veriyoruz (stale closure). */
  function handleEmployeeChange(next: string) {
    setEmployeeId(next)
    if (submitted) setErrors(validate(next))
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
        errors.employeeId && { fieldId: 'leave-employee', message: errors.employeeId },
        errors.dates && { fieldId: 'leave-start', message: errors.dates },
        errors.days && { fieldId: 'leave-start', message: errors.days },
      ].filter(Boolean) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni izin talebi"
      note="Talep gönderilince onay zinciri başlar."
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
            form="new-leave-form"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Talebi gönder
          </Button>
        </>
      }
    >
      <form id="new-leave-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorSummary items={summary} />

        <EmployeePicker
          id="leave-employee"
          value={employeeId}
          onChange={handleEmployeeChange}
          hint={submitted ? errors.employeeId : undefined}
        />

        <SelectField
          id="leave-type"
          label="İzin türü"
          required
          value={type}
          onChange={(v) => setType(v as LeaveType)}
          options={(Object.keys(leaveTypeLabels) as LeaveType[]).map((t) => ({
            value: t,
            label: leaveTypeLabels[t],
          }))}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="leave-start"
            label="Başlangıç"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onBlur={() => submitted && setErrors(validate())}
            error={errors.dates}
          />
          <TextField
            id="leave-end"
            label="Bitiş"
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={() => submitted && setErrors(validate())}
          />
        </div>

        {/* Bakiye özeti: kullanıcı göndermeden önce durumu görsün */}
        {employeeId && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            {balances.isPending ? (
              <p className="text-[13px] text-muted-foreground">Bakiye yükleniyor</p>
            ) : !balance ? (
              <p
                role="alert"
                className="border-l-2 border-[hsl(var(--warning))] pl-3 text-[13px] leading-relaxed"
              >
                {year} yılı için {leaveTypeLabels[type].toLocaleLowerCase('tr-TR')} bakiyesi tanımlı
                değil. Talep yine de gönderilebilir; onaycı bakiyesiz durumu görür.
              </p>
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted-foreground">
                  Kalan bakiye{' '}
                  <span className="tabular font-semibold text-foreground">
                    {formatNumber(balance.remainingDays)}
                  </span>{' '}
                  gün
                </span>
                <span className="text-muted-foreground">
                  Bu talep{' '}
                  <span className="tabular font-semibold text-foreground">
                    {formatNumber(days)}
                  </span>{' '}
                  gün
                </span>
              </div>
            )}

            {balance && shortfall > 0 && (
              <p
                role="alert"
                className="mt-2 border-l-2 border-[hsl(var(--warning))] pl-3 text-[12px] leading-relaxed"
              >
                Bakiyeniz {shortfall} gün yetersiz. Talebi yine de gönderebilirsiniz; kararı onay
                zinciri verir.
              </p>
            )}
          </div>
        )}

        <TextAreaField
          id="leave-reason"
          label="Gerekçe"
          rows={3}
          value={reason}
          maxLength={500}
          hint="İsteğe bağlı. Onaycıya görünür."
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  )
}
