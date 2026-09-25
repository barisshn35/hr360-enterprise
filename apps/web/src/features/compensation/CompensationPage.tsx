import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatCard } from '@/components/ui/StatCard'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { EmptyState, ErrorState, RowsSkeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { compensationApi } from '@/api/compensation'
import { useCompensationBands, useCompensationRecords, useEmployees } from '@/api/queries'
import {
  compensationReasonLabels,
  type CompensationBand,
  type CompensationChangeReason,
  type SimulationResult,
} from '@/api/types'
import { formatDate, formatMoney, formatNumber, fullName, normalizeSearch } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'
import { cn } from '@/lib/utils'

type TabKey = 'bantlar' | 'gecmis' | 'simulasyon'

/* ------------------------------------------------------------------ bantlar */

function NewBandModal({
  open,
  onClose,
  year,
}: {
  open: boolean
  onClose: () => void
  year: number
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [grade, setGrade] = useState('')
  const [title, setTitle] = useState('')
  const [minAmount, setMin] = useState('')
  const [midAmount, setMid] = useState('')
  const [maxAmount, setMax] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      compensationApi.createBand({
        grade: grade.trim(),
        title: title.trim() || undefined,
        minAmount: Number(minAmount),
        midAmount: Number(midAmount),
        maxAmount: Number(maxAmount),
        currency: 'TRY',
        year,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compensation'] })
      toast.ok('Ücret bandı eklendi')
      onClose()
      setGrade('')
      setTitle('')
      setMin('')
      setMid('')
      setMax('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Bant eklenemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!grade.trim()) return setError('Kademe zorunlu.')
    const [lo, mid, hi] = [Number(minAmount), Number(midAmount), Number(maxAmount)]
    if (!lo || !mid || !hi) return setError('Alt, orta ve üst tutar zorunlu.')
    if (!(lo <= mid && mid <= hi)) return setError('Tutarlar alt ≤ orta ≤ üst sırasında olmalı.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni ücret bandı"
      note={`${year} yılı`}
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
            form="new-band"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Bandı ekle
          </Button>
        </>
      }
    >
      <form id="new-band" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="band-grade"
            label="Kademe"
            required
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            error={error?.includes('Kademe') ? error : undefined}
          />
          <TextField
            id="band-title"
            label="Unvan"
            hint="İsteğe bağlı"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            id="band-min"
            label="Alt"
            type="number"
            min={0}
            required
            className="tabular"
            value={minAmount}
            onChange={(e) => setMin(e.target.value)}
          />
          <TextField
            id="band-mid"
            label="Orta"
            type="number"
            min={0}
            required
            className="tabular"
            value={midAmount}
            onChange={(e) => setMid(e.target.value)}
          />
          <TextField
            id="band-max"
            label="Üst"
            type="number"
            min={0}
            required
            className="tabular"
            value={maxAmount}
            onChange={(e) => setMax(e.target.value)}
            error={error?.includes('tutar') || error?.includes('sırasında') ? error : undefined}
          />
        </div>
      </form>
    </Modal>
  )
}

/**
 * Bant çizgisi: alt–üst aralığı yatay bir şerit, orta nokta işaretli.
 * Sayı sütunları zaten var; bu şerit bantların birbirine göre yerini
 * tek bakışta okutmak için.
 */
function BandSpan({
  band,
  floor,
  ceiling,
}: {
  band: CompensationBand
  floor: number
  ceiling: number
}) {
  const reduced = useReducedMotion()
  const span = Math.max(1, ceiling - floor)
  const left = ((band.minAmount - floor) / span) * 100
  const width = Math.max(2, ((band.maxAmount - band.minAmount) / span) * 100)
  const midPoint =
    ((band.midAmount - band.minAmount) / Math.max(1, band.maxAmount - band.minAmount)) * 100

  return (
    <div className="relative h-1.5 w-full min-w-24 overflow-hidden rounded-full bg-muted">
      <motion.div
        className="absolute inset-y-0 rounded-full bg-primary/70"
        style={{ left: `${left}%` }}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${width}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-foreground"
          style={{ left: `${midPoint}%` }}
        />
      </motion.div>
    </div>
  )
}

function BandsTab({ year, onYearChange }: { year: number; onYearChange: (y: number) => void }) {
  const [modalOpen, setModalOpen] = useState(false)
  const bands = useCompensationBands(year)

  const { floor, ceiling } = useMemo(() => {
    const list = bands.data ?? []
    if (list.length === 0) return { floor: 0, ceiling: 1 }
    return {
      floor: Math.min(...list.map((b) => b.minAmount)),
      ceiling: Math.max(...list.map((b) => b.maxAmount)),
    }
  }, [bands.data])

  const columns: Array<Column<CompensationBand>> = [
    {
      id: 'grade',
      header: 'Kademe',
      searchText: (b) => `${b.grade} ${b.title ?? ''}`,
      sortValue: (b) => b.grade,
      exportText: (b) => b.grade,
      cell: (b) => (
        <div className="min-w-0">
          <p className="font-semibold">{b.grade}</p>
          {b.title && <p className="text-[12px] text-muted-foreground">{b.title}</p>}
        </div>
      ),
    },
    {
      id: 'span',
      header: 'Aralık',
      hideBelow: 'md',
      cell: (b) => <BandSpan band={b} floor={floor} ceiling={ceiling} />,
    },
    {
      id: 'min',
      header: 'Alt',
      align: 'right',
      sortValue: (b) => b.minAmount,
      exportText: (b) => formatMoney(b.minAmount, b.currency),
      cell: (b) => (
        <span className="text-muted-foreground">{formatMoney(b.minAmount, b.currency)}</span>
      ),
    },
    {
      id: 'mid',
      header: 'Orta',
      align: 'right',
      sortValue: (b) => b.midAmount,
      exportText: (b) => formatMoney(b.midAmount, b.currency),
      cell: (b) => <span className="font-semibold">{formatMoney(b.midAmount, b.currency)}</span>,
    },
    {
      id: 'max',
      header: 'Üst',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (b) => b.maxAmount,
      exportText: (b) => formatMoney(b.maxAmount, b.currency),
      cell: (b) => (
        <span className="text-muted-foreground">{formatMoney(b.maxAmount, b.currency)}</span>
      ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <TextField
          id="band-year"
          label="Yıl"
          type="number"
          min={2020}
          max={2100}
          className="tabular w-28"
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        />
        <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
          <Plus className="size-4" />
          Yeni bant
        </Button>
      </div>

      <DataTable
        rows={bands.data}
        rowKey={(b) => b.id}
        columns={columns}
        isLoading={bands.isPending}
        error={bands.error}
        onRetry={() => void bands.refetch()}
        searchPlaceholder="Kademe veya unvan ara"
        exportFileName={`ucret-bantlari-${year}`}
        initialSort={{ columnId: 'min', dir: 'asc' }}
        emptyTitle="Bu yıl için bant yok"
        emptyDetail="Bantlar tanımlanmadan zam simülasyonu bant dışı satırları işaretleyemez."
        emptyAction={
          <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
            Yeni bant
          </Button>
        }
      />

      <NewBandModal open={modalOpen} onClose={() => setModalOpen(false)} year={year} />
    </>
  )
}

/* ------------------------------------------------------------------ geçmiş */

function NewRecordModal({
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
  const [baseSalary, setSalary] = useState('')
  const [grade, setGrade] = useState('')
  const [reason, setReason] = useState<CompensationChangeReason>('AnnualIncrease')
  const [effectiveFrom, setFrom] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      compensationApi.createRecord({
        employeeId,
        baseSalary: Number(baseSalary),
        currency: 'TRY',
        grade: grade.trim() || undefined,
        reason,
        effectiveFrom,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compensation'] })
      toast.ok('Ücret kaydı eklendi')
      onClose()
      setSalary('')
      setNote('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Kayıt eklenemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!Number(baseSalary)) return setError('Taban ücret zorunlu.')
    if (!effectiveFrom) return setError('Geçerlilik tarihi zorunlu.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni ücret kaydı"
      note="Önceki kayıt otomatik olarak kapanır."
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
            form="new-record"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Kaydet
          </Button>
        </>
      }
    >
      <form id="new-record" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="rec-salary"
            label="Taban ücret"
            type="number"
            min={0}
            required
            className="tabular"
            value={baseSalary}
            onChange={(e) => setSalary(e.target.value)}
            error={error?.includes('Taban') ? error : undefined}
          />
          <TextField
            id="rec-grade"
            label="Kademe"
            hint="İsteğe bağlı"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="rec-reason"
            label="Gerekçe"
            value={reason}
            onChange={(v) => setReason(v as CompensationChangeReason)}
            options={(Object.keys(compensationReasonLabels) as CompensationChangeReason[]).map(
              (r) => ({ value: r, label: compensationReasonLabels[r] }),
            )}
          />
          <TextField
            id="rec-from"
            label="Geçerlilik başlangıcı"
            type="date"
            required
            value={effectiveFrom}
            onChange={(e) => setFrom(e.target.value)}
            error={error?.includes('Geçerlilik') ? error : undefined}
          />
        </div>
        <TextAreaField
          id="rec-note"
          label="Not"
          rows={2}
          hint="İsteğe bağlı"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </form>
    </Modal>
  )
}

function HistoryTab() {
  const [employeeId, setEmployeeId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const records = useCompensationRecords(employeeId || undefined, Boolean(employeeId))
  const reduced = useReducedMotion()

  const rows = useMemo(
    () => [...(records.data ?? [])].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1)),
    [records.data],
  )

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-72">
          <EmployeePicker
            id="comp-employee"
            value={employeeId}
            onChange={setEmployeeId}
            hint="Ücret geçmişini görmek için çalışan seçin."
          />
        </div>
        {employeeId && (
          <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Ücret kaydı ekle
          </Button>
        )}
      </div>

      <Panel>
        <PanelHead title="Ücret geçmişi" note="En yeni kayıt en üstte" />
        {!employeeId ? (
          <EmptyState
            title="Çalışan seçilmedi"
            detail="Ücret verisi hassastır; yalnızca seçilen çalışanın kaydı getirilir."
          />
        ) : records.isPending ? (
          <RowsSkeleton rows={4} columns={3} />
        ) : records.isError ? (
          <ErrorState
            message={records.error instanceof Error ? records.error.message : undefined}
            onRetry={() => void records.refetch()}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Ücret kaydı yok"
            detail="Bu çalışan için henüz bir ücret kaydı girilmemiş."
          />
        ) : (
          <PanelBody>
            <ol className="relative space-y-6 pl-6">
              <span
                aria-hidden="true"
                className="absolute top-1.5 bottom-1.5 left-[5px] w-px bg-border"
              />
              {rows.map((r, i) => {
                const previous = rows[i + 1]
                const delta = previous ? r.baseSalary - previous.baseSalary : null
                const percent =
                  previous && previous.baseSalary > 0 ? (delta! / previous.baseSalary) * 100 : null

                return (
                  <motion.li
                    key={r.id}
                    className="relative"
                    initial={reduced ? false : { opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      duration: 0.3,
                      ease: 'easeOut',
                      delay: Math.min(i * 0.04, 0.24),
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-1.5 -left-6 size-[11px] rounded-full border-2 border-card',
                        i === 0 ? 'bg-primary' : 'bg-muted-foreground/50',
                      )}
                    />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="tabular text-[19px] leading-none font-bold">
                        {formatMoney(r.baseSalary, r.currency)}
                      </span>
                      <span className="flex items-center gap-2">
                        {delta !== null && delta !== 0 && (
                          <StatusBadge tone={delta > 0 ? 'success' : 'danger'}>
                            {delta > 0 ? '+' : '−'}
                            {formatMoney(Math.abs(delta), r.currency)}
                            {percent !== null && ` (%${Math.abs(percent).toFixed(1)})`}
                          </StatusBadge>
                        )}
                        <StatusBadge tone="neutral">
                          {compensationReasonLabels[r.reason]}
                        </StatusBadge>
                      </span>
                    </div>
                    <p className="tabular mt-1 text-[12px] text-muted-foreground">
                      {formatDate(r.effectiveFrom)}
                      {r.effectiveTo ? ` – ${formatDate(r.effectiveTo)}` : ' – sürüyor'}
                      {r.grade ? `, kademe ${r.grade}` : ''}
                    </p>
                    {r.note && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                        {r.note}
                      </p>
                    )}
                  </motion.li>
                )
              })}
            </ol>
          </PanelBody>
        )}
      </Panel>

      <NewRecordModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        employeeId={employeeId}
      />
    </>
  )
}

/* -------------------------------------------------------------- simülasyon */

function SimulationTab({ year }: { year: number }) {
  const toast = useToast()
  const employees = useEmployees()
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<'percent' | 'flat'>('percent')
  const [amount, setAmount] = useState('10')
  const [result, setResult] = useState<SimulationResult | null>(null)
  const reduced = useReducedMotion()
  const nameOf = useEmployeeName()

  const filtered = useMemo(() => {
    const list = employees.data ?? []
    if (!search.trim()) return list
    const q = normalizeSearch(search)
    return list.filter((e) => normalizeSearch(fullName(e)).includes(q))
  }, [employees.data, search])

  const mutation = useMutation({
    mutationFn: () =>
      compensationApi.simulate({
        employeeIds: selected,
        increasePercent: mode === 'percent' ? Number(amount) : undefined,
        flatIncrease: mode === 'flat' ? Number(amount) : undefined,
        year,
      }),
    onSuccess: (data) => setResult(data),
    onError: (e: unknown) =>
      toast.stop(e instanceof Error ? e.message : 'Simülasyon çalıştırılamadı.'),
  })

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  type Line = SimulationResult['lines'][number]

  const lineColumns: Array<Column<Line>> = [
    {
      id: 'employee',
      header: 'Çalışan',
      searchText: (l) => nameOf(l.employeeId),
      sortValue: (l) => nameOf(l.employeeId),
      exportText: (l) => nameOf(l.employeeId),
      cell: (l) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{nameOf(l.employeeId)}</p>
          {l.grade && <p className="text-[12px] text-muted-foreground">Kademe {l.grade}</p>}
        </div>
      ),
    },
    {
      id: 'current',
      header: 'Mevcut',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (l) => l.currentSalary,
      exportText: (l) => formatMoney(l.currentSalary),
      cell: (l) => <span className="text-muted-foreground">{formatMoney(l.currentSalary)}</span>,
    },
    {
      id: 'proposed',
      header: 'Önerilen',
      align: 'right',
      sortValue: (l) => l.proposedSalary,
      exportText: (l) => formatMoney(l.proposedSalary),
      cell: (l) => (
        <span className={cn('font-semibold', !l.withinBand && 'text-destructive')}>
          {formatMoney(l.proposedSalary)}
        </span>
      ),
    },
    {
      id: 'increase',
      header: 'Artış',
      align: 'right',
      hideBelow: 'md',
      sortValue: (l) => l.increaseAmount,
      exportText: (l) => `${formatMoney(l.increaseAmount)} (%${l.increasePercent.toFixed(1)})`,
      cell: (l) => (
        <span>
          +{formatMoney(l.increaseAmount)}
          <span className="block text-[11px] text-muted-foreground">
            %{l.increasePercent.toFixed(1)}
          </span>
        </span>
      ),
    },
    {
      id: 'band',
      header: 'Bant',
      align: 'right',
      sortValue: (l) => (l.withinBand ? 1 : 0),
      exportText: (l) => (l.withinBand ? 'Bant içi' : 'Bant dışı'),
      cell: (l) =>
        l.withinBand ? (
          <StatusBadge tone="success">Bant içi</StatusBadge>
        ) : (
          <StatusBadge tone="danger">
            Bant dışı{l.bandMax ? `, üst ${formatMoney(l.bandMax)}` : ''}
          </StatusBadge>
        ),
    },
  ]

  return (
    <>
      <Panel>
        <PanelHead
          title="Zam simülasyonu"
          note="Kaydedilmez; yalnızca bütçe etkisini hesaplar."
          action={
            selected.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={() => setSelected([])}
              >
                Seçimi temizle
              </Button>
            ) : undefined
          }
        />
        <PanelBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
            <TextField
              id="sim-search"
              label="Çalışan ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              hint={`${formatNumber(selected.length)} çalışan seçildi`}
            />
            <SelectField
              id="sim-mode"
              label="Artış türü"
              value={mode}
              onChange={(v) => setMode(v as 'percent' | 'flat')}
              options={[
                { value: 'percent', label: 'Yüzde' },
                { value: 'flat', label: 'Sabit tutar' },
              ]}
            />
            <TextField
              id="sim-amount"
              label={mode === 'percent' ? 'Yüzde (%)' : 'Tutar'}
              type="number"
              min={0}
              className="tabular"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          {employees.isPending ? (
            <RowsSkeleton rows={4} columns={2} />
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              <ul className="divide-y divide-border">
                {filtered.map((e) => (
                  <li key={e.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50">
                      <Checkbox
                        checked={selected.includes(e.id)}
                        onCheckedChange={() => toggle(e.id)}
                      />
                      <span className="min-w-0 truncate text-[14px]">{fullName(e)}</span>
                    </label>
                  </li>
                ))}
                {filtered.length === 0 && (
                  <li className="px-3 py-4 text-[13px] text-muted-foreground">
                    Aramaya uyan çalışan yok.
                  </li>
                )}
              </ul>
            </div>
          )}

          <div>
            <Button
              className="cursor-pointer"
              disabled={mutation.isPending || selected.length === 0 || !Number(amount)}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
              Simülasyonu çalıştır
            </Button>
          </div>
        </PanelBody>
      </Panel>

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={`${result.employeeCount}-${result.proposedTotal}`}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className="space-y-5"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Kapsanan çalışan"
                value={formatNumber(result.employeeCount)}
                trend="Simülasyonda"
                trendDirection="flat"
                trendSense="neutral"
              />
              <StatCard
                label="Mevcut toplam"
                value={formatMoney(result.currentTotal)}
                trend="Bugünkü bordro"
                trendDirection="flat"
                trendSense="neutral"
              />
              <StatCard
                label="Bütçe etkisi"
                value={`+${formatMoney(result.budgetImpact)}`}
                trend={`yeni toplam ${formatMoney(result.proposedTotal)}`}
                trendDirection="up"
                trendSense="negative"
              />
              <StatCard
                label="Bant dışı"
                value={formatNumber(result.outOfBandCount)}
                trend={
                  result.outOfBandCount > 0 ? 'kademe üst sınırını aşıyor' : 'tümü bant içinde'
                }
                trendDirection={result.outOfBandCount > 0 ? 'up' : 'flat'}
                trendSense="negative"
              />
            </div>

            {result.lines.length === 0 ? (
              <Panel>
                <PanelHead title="Satır bazında etki" note={`${year} bantlarına göre`} />
                <EmptyState
                  title="Satır yok"
                  detail="Seçilen çalışanların yürürlükteki ücret kaydı bulunamadı."
                />
              </Panel>
            ) : (
              <DataTable
                rows={result.lines}
                rowKey={(l) => l.employeeId}
                columns={lineColumns}
                searchPlaceholder="Çalışan ara"
                exportFileName={`zam-simulasyonu-${year}`}
                pageSize={15}
                rowClassName={(l) => (!l.withinBand ? 'bg-destructive/5' : undefined)}
                emptyTitle="Satır yok"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* ------------------------------------------------------------------- sayfa */

export function CompensationPage() {
  const [tab, setTab] = useTabParam<TabKey>('gorunum', 'bantlar')
  const [year, setYear] = useState(new Date().getFullYear())

  const TABS: Array<TabDef<TabKey>> = [
    { key: 'bantlar', label: 'Ücret bantları' },
    { key: 'gecmis', label: 'Çalışan geçmişi' },
    { key: 'simulasyon', label: 'Zam simülasyonu' },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ücret"
        description="Ücret bantları, çalışan ücret geçmişi ve zam simülasyonu. Bu sayfa yalnızca İK yönetimine açıktır."
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Ücret görünümü" />

      {tab === 'bantlar' && <BandsTab year={year} onYearChange={setYear} />}
      {tab === 'gecmis' && <HistoryTab />}
      {tab === 'simulasyon' && <SimulationTab year={year} />}
    </div>
  )
}
