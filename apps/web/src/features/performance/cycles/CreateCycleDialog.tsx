/**
 * Yeni dönem. Tür ve yıl seçilince ad ve tarihler önerilir; kullanıcı
 * isterse değiştirir. Çakışan dönem varsa uyarılır (backend karar verir).
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarPlus, Info, TriangleAlert } from 'lucide-react'
import { CYCLE_PERIODS, cyclePeriodLabels, useCreateCycle, type CyclePeriod, type ReviewCycle } from '@/api/performance'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/format'
import { Segmented, errorText } from '../components/controls'
import { NumberStepper } from '../components/NumberStepper'
import { defaultsFor, nextSuggestion, overlapping } from './cycleDefaults'

export function CreateCycleDialog({ cycles, onClose }: { cycles: ReviewCycle[]; onClose: () => void }) {
  const toast = useToast()
  const create = useCreateCycle()
  const suggestion = nextSuggestion(cycles)
  const [year, setYear] = useState(suggestion.year)
  const [period, setPeriod] = useState<CyclePeriod>(suggestion.period)
  const [form, setForm] = useState(() => defaultsFor(suggestion.year, suggestion.period))
  const [edited, setEdited] = useState({ name: false, dates: false })
  const [error, setError] = useState<string | null>(null)

  const apply = (y: number, p: CyclePeriod) => {
    const d = defaultsFor(y, p)
    setForm((f) => ({
      name: edited.name ? f.name : d.name,
      startDate: edited.dates ? f.startDate : d.startDate,
      endDate: edited.dates ? f.endDate : d.endDate,
    }))
    setError(null)
  }

  const invalidDates = Boolean(form.startDate && form.endDate && form.endDate <= form.startDate)
  const clash = !invalidDates && form.startDate && form.endDate ? overlapping(cycles, form.startDate, form.endDate) : []
  const duplicate = cycles.find((c) => c.year === year && c.period === period)

  const submit = () => {
    if (!form.name.trim() || invalidDates || !form.startDate || !form.endDate) return
    create.mutate(
      { name: form.name.trim(), year, period, startDate: form.startDate, endDate: form.endDate },
      {
        onSuccess: (c) => {
          toast.ok(`«${c.name}» taslak olarak oluşturuldu. Hazır olduğunuzda açın.`)
          onClose()
        },
        onError: (e) => setError(errorText(e)),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Yeni değerlendirme dönemi"
      note="Dönem taslak olarak oluşturulur. Açıldığında hedefler ve değerlendirmeler bu döneme bağlanır."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={create.isPending || invalidDates || !form.name.trim()}>
            <CalendarPlus aria-hidden />
            {create.isPending ? 'Oluşturuluyor…' : 'Dönemi oluştur'}
          </Button>
        </>
      }
    >
      <AnimatePresence>
        {error && (
          <motion.p
            role="alert"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 flex items-start gap-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive"
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <p className="mb-1.5 text-[13px] font-medium">Yıl</p>
            <NumberStepper
              value={year}
              onChange={(v) => {
                setYear(v)
                apply(v, period)
              }}
              min={2000}
              max={2100}
              ariaLabel="Yıl"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="mb-1.5 text-[13px] font-medium">Dönem türü</p>
            <Segmented
              ariaLabel="Dönem türü"
              value={period}
              onChange={(p) => {
                setPeriod(p)
                apply(year, p)
              }}
              options={CYCLE_PERIODS.map((p) => ({ value: p, label: p === 'Annual' ? 'Yıllık' : p, title: cyclePeriodLabels[p] }))}
              size="sm"
            />
          </div>
        </div>

        <TextField
          label="Ad"
          value={form.name}
          onChange={(e) => {
            setForm((f) => ({ ...f, name: e.target.value }))
            setEdited((x) => ({ ...x, name: true }))
          }}
          hint="Listelerde ve raporlarda bu adla görünür."
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Başlangıç"
            type="date"
            value={form.startDate}
            onChange={(e) => {
              setForm((f) => ({ ...f, startDate: e.target.value }))
              setEdited((x) => ({ ...x, dates: true }))
            }}
          />
          <TextField
            label="Bitiş"
            type="date"
            value={form.endDate}
            onChange={(e) => {
              setForm((f) => ({ ...f, endDate: e.target.value }))
              setEdited((x) => ({ ...x, dates: true }))
            }}
            error={invalidDates ? 'Bitiş tarihi başlangıçtan sonra olmalı.' : undefined}
          />
        </div>

        <AnimatePresence>
          {(duplicate || clash.length > 0) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <p className="flex items-start gap-2 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/8 px-3 py-2.5 text-[12px] leading-relaxed">
                <Info className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
                <span>
                  {duplicate && (
                    <>
                      {year} yılı için bu türde bir dönem zaten var: <strong className="font-medium">{duplicate.name}</strong>.{' '}
                    </>
                  )}
                  {clash.length > 0 && (
                    <>
                      Bu tarihler şu dönemlerle çakışıyor:{' '}
                      {clash.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && ', '}
                          <strong className="font-medium">{c.name}</strong> ({formatDate(c.startDate)} – {formatDate(c.endDate)})
                        </span>
                      ))}
                      .
                    </>
                  )}
                </span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
