import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { Modal, ErrorSummary, type SummaryItem } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { leaveApi } from '@/api/leave'
import { apiFetch } from '@/api/client'
import { useLeaveBalances, useLeaveHolidays, useMyEmployeeId } from '@/api/queries'
import { useAuth } from '@/auth/useAuth'
import { leaveTypeLabels, type LeaveType } from '@/api/types'
import { formatNumber, parseDecimal } from '@/lib/format'
import { tx, appLocale } from '@/lib/i18n'

interface Errors {
  employeeId?: string
  dates?: string
  days?: string
  hours?: string
}

/**
 * Saatlik izin alanı (tek gün): boşsa tam gün. Önceden "-1"/"abc" sessizce tam güne
 * dönüyordu; artık alan hatası verilir. Kural sunucuyla aynı: 0,5 saatlik adımlarla, 7,5'ten az.
 */
function hoursError(raw: string): string | undefined {
  if (!raw.trim()) return undefined
  const v = parseDecimal(raw)
  if (v === null) return tx('Geçerli bir saat girin (ör. 2,5).')
  if (v <= 0 || v >= 7.5) return tx('Saat 0’dan büyük ve 7,5’ten küçük olmalı.')
  if (!Number.isInteger(v * 2)) return tx('Saat 0,5’lik adımlarla girilmeli.')
  return undefined
}

/**
 * Bitiş dahil İŞ GÜNÜ sayısı (Pzt–Cum). Backend gün sayısını artık kendisi aynı
 * kuralla hesaplıyor (istemcinin gönderdiği değere güvenmiyor); önizleme ondan
 * sapmasın. Tarihler UTC olarak ayrıştırılır ki yerel saat dilimi günü kaydırmasın.
 */
function daysBetween(start: string, end: string, holidays: ReadonlySet<string> = new Set()): number {
  if (!start || !end) return 0
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  let count = 0
  for (let t = a; t <= b; t += 86_400_000) {
    const d = new Date(t)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6 && !holidays.has(d.toISOString().slice(0, 10))) count++
  }
  return count
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
  // Onay akışı tanımında gerekçe onaycıdan gizlenmişse form metni buna göre değişir
  // (workflow-service gizli alanı onaycıya döndürmez).
  const reasonHidden = useQuery({
    queryKey: ['workflow', 'hidden-fields', 'LeaveRequest'],
    queryFn: ({ signal }) =>
      apiFetch<string[]>('/api/workflow/workflows/definitions/hidden-fields?type=LeaveRequest', { signal }),
    select: (fields) => fields.some((f) => f.toLowerCase() === 'reason'),
    enabled: open,
    staleTime: 5 * 60_000,
  })
  const queryClient = useQueryClient()

  // İK dışındakiler yalnızca kendi adlarına talep açabilir (backend 403 döner);
  // bu yüzden seçici İK'ya gösterilir, diğerleri için çalışan sabit "siz"dir.
  const { roles } = useAuth()
  const isHr = roles.some((r) => r === 'hr-admin' || r === 'tenant-admin' || r === 'platform-admin')
  // İK için de çekilir: başkası adına girerken iletiler "bakiyeniz" yerine çalışana göre yazılır.
  const me = useMyEmployeeId(open)
  // İK'nın seçimini, kendi kimliği sonradan yüklenince sıfırlamamak için yalnızca İK dışında izlenir.
  const selfIdForReset = isHr ? undefined : me.employeeId

  const [employeeId, setEmployeeId] = useState(defaultEmployeeId)
  const [type, setType] = useState<LeaveType>('Annual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [hours, setHours] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (open) {
      setEmployeeId(isHr ? defaultEmployeeId : (selfIdForReset ?? ''))
    } else {
      setType('Annual')
      setStartDate('')
      setEndDate('')
      setReason('')
      setHours('')
      setErrors({})
      setSubmitted(false)
    }
  }, [open, defaultEmployeeId, isHr, selfIdForReset])

  const year = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear()
  const balances = useLeaveBalances(employeeId || undefined, year, Boolean(employeeId))

  // Resmi tatiller de düşülür (backend aynı takvimi kullanıyor).
  const holidays = useLeaveHolidays(year, open)
  const holidaySet = useMemo(() => new Set((holidays.data ?? []).map((h) => h.date.slice(0, 10))), [holidays.data])
  const singleDay = !!startDate && startDate === endDate
  const hoursInvalid = singleDay ? hoursError(hours) : undefined
  const hourValue = singleDay && hours.trim() && !hoursInvalid ? parseDecimal(hours) ?? 0 : 0
  // Saatlik izin (tek gün): gün = saat / 7,5 (backend aynı kuralı uygular, LEAVE_DAY_HOURS).
  const days = useMemo(() => (hourValue > 0 ? Math.round((hourValue / 7.5) * 100) / 100 : daysBetween(startDate, endDate, holidaySet)), [startDate, endDate, holidaySet, hourValue])
  const balance = balances.data?.find((b) => b.type === type)
  /**
   * Backend kuralıyla aynı: bakiye yetersizse talep reddedilir; yıllık izin için
   * bakiye tanımı zorunludur (diğer türler bakiyesiz açılabilir).
   */
  const shortfall = balance ? days - balance.remainingDays : 0
  const onBehalf = isHr && Boolean(employeeId) && employeeId !== me.employeeId
  const blockedByBalance =
    Boolean(employeeId) && !balances.isPending && ((balance && shortfall > 0) || (!balance && type === 'Annual'))

  const mutation = useMutation({
    mutationFn: () =>
      leaveApi.createRequest({
        employeeId,
        type,
        startDate,
        endDate,
        days,
        reason: reason.trim() || undefined,
        hours: hourValue > 0 ? hourValue : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['leave'] })
      toast.ok(tx('İzin talebi oluşturuldu, onay zincirine gönderildi'))
      onClose()
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : tx('Talep oluşturulamadı.')),
  })

  function validate(overrideEmployeeId?: string): Errors {
    const next: Errors = {}
    if (!(overrideEmployeeId ?? employeeId)) next.employeeId = tx('Çalışan seçilmeli.')
    if (!startDate || !endDate) {
      next.dates = tx('Başlangıç ve bitiş tarihi zorunlu.')
    } else if (new Date(endDate) < new Date(startDate)) {
      next.dates = tx('Bitiş tarihi başlangıçtan önce olamaz.')
    } else if (days <= 0) {
      // Yalnızca tarihler doluyken ve aralık ters değilken anlamlı - aksi
      // halde yukarıdaki iki kural zaten aynı kök sebep (eksik/geçersiz
      // tarih) için ikinci, gereksiz bir hata satırı daha üretiyordu.
      // Tarihler geçerli ama aralıkta yalnızca hafta sonu/resmî tatil var.
      next.days = tx('Seçilen aralıkta iş günü yok.')
    }
    if (hoursInvalid) next.hours = hoursInvalid
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
        errors.hours && { fieldId: 'leave-hours', message: errors.hours },
      ].filter(Boolean) as SummaryItem[])
    : []

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx('Yeni izin talebi')}
      note={tx('Talep gönderilince onay zinciri başlar.')}
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            type="submit"
            form="new-leave-form"
            className="cursor-pointer"
            disabled={mutation.isPending || blockedByBalance}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Talebi gönder')}
          </Button>
        </>
      }
    >
      <form id="new-leave-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <ErrorSummary items={summary} />

        {isHr ? (
          <EmployeePicker
            id="leave-employee"
            value={employeeId}
            onChange={handleEmployeeChange}
            hint={submitted ? errors.employeeId : undefined}
          />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {me.notLinked
              ? tx('Hesabınıza bağlı çalışan kaydı bulunamadı; izin talebi açamazsınız.')
              : tx('Talep sizin adınıza oluşturulacak.')}
          </p>
        )}

        <SelectField
          id="leave-type"
          label={tx('İzin türü')}
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
            label={tx('Başlangıç')}
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            onBlur={() => submitted && setErrors(validate())}
            error={errors.dates}
          />
          <TextField
            id="leave-end"
            label={tx('Bitiş')}
            type="date"
            required
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            onBlur={() => submitted && setErrors(validate())}
          />
        </div>

        {singleDay && (
          <TextField
            id="leave-hours"
            label={tx('Saatlik izin (isteğe bağlı)')}
            inputMode="decimal"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            error={hoursInvalid}
            hint={tx('Günün bir kısmı için: 0,5 saatlik adımlarla, 7,5 saatten az. Boş bırakırsanız tam gün.')}
          />
        )}

        {/* Bakiye özeti: kullanıcı göndermeden önce durumu görsün */}
        {employeeId && (
          <div className="rounded-md border border-border bg-muted/40 p-3">
            {balances.isPending ? (
              <p className="text-[13px] text-muted-foreground">{tx('Bakiye yükleniyor')}</p>
            ) : !balance ? (
              <p
                role="alert"
                className="border-l-2 border-[hsl(var(--warning))] pl-3 text-[13px] leading-relaxed"
              >
                {tx('{0} yılı için {1} bakiyesi tanımlı değil. {2}', [year, leaveTypeLabels[type].toLocaleLowerCase(appLocale), type === 'Annual'
                  ? (onBehalf ? tx('Yıllık izin bakiye tanımı olmadan talep edilemez; önce çalışana bakiye tanımlayın.') : tx('Yıllık izin bakiye tanımı olmadan talep edilemez; İK ile iletişime geçin.'))
                  : tx('Bu izin türü bakiyesiz de talep edilebilir.')])}
              </p>
            ) : (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
                <span className="text-muted-foreground">{tx('Kalan bakiye', [])}{' '}
                  <span className="tabular font-semibold text-foreground">
                    {formatNumber(balance.remainingDays)}
                  </span>{' '}{tx('gün', [])}</span>
                <span className="text-muted-foreground">{tx('Bu talep', [])}{' '}
                  <span className="tabular font-semibold text-foreground">
                    {formatNumber(days)}
                  </span>{' '}{tx('gün', [])}</span>
              </div>
            )}

            {balance && shortfall > 0 && (
              <p
                role="alert"
                className="mt-2 border-l-2 border-[hsl(var(--warning))] pl-3 text-[12px] leading-relaxed"
              >{onBehalf
                ? tx('Çalışanın bakiyesi {0} gün yetersiz; bu talep gönderilemez. Tarihleri kısaltın ya da bakiyeyi güncelleyin.', [shortfall])
                : tx('Bakiyeniz {0} gün yetersiz; bu talep gönderilemez. Tarihleri kısaltın ya da İK ile iletişime geçin.', [shortfall])}</p>
            )}
          </div>
        )}

        <TextAreaField
          id="leave-reason"
          label={tx('Gerekçe')}
          rows={3}
          value={reason}
          maxLength={500}
          hint={
            reasonHidden.data
              ? tx('İsteğe bağlı. Onaycıdan gizlenir; yalnızca İK görür. Sağlık bilgisi (tanı) yazmayın.')
              : tx('İsteğe bağlı. Onaycınız ve İK görür. Sağlık bilgisi (tanı) yazmayın.')
          }
          onChange={(e) => setReason(e.target.value)}
        />
      </form>
    </Modal>
  )
}
