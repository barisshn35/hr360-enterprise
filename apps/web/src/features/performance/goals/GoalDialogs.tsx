/**
 * Hedef oluştur ve ilerleme güncelle.
 * İkisi de canlı önizleme gösterir: pay (ağırlık → yüzde) ve ilerleme çubuğu.
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Flame, TriangleAlert } from 'lucide-react'
import {
  GOAL_STATUSES,
  formatShareOf,
  goalStatusLabels,
  shareOf,
  useCreateGoal,
  useUpdateGoalProgress,
  type Goal,
  type GoalStatus,
  type ReviewCycle,
} from '@/api/performance'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { EASE } from '@/motion/primitives'
import { Segmented, Switch, errorText } from '../components/controls'
import { NumberStepper } from '../components/NumberStepper'
import { ShareBar } from '../components/WeightShare'
import { formatGoalValue, progressOf } from './goalMath'

function ErrorLine({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-4 flex items-start gap-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

const parse = (s: string) => {
  const n = Number(s.replace(/\./g, '').replace(',', '.').trim())
  return s.trim() === '' || !Number.isFinite(n) ? null : n
}

/* --------------------------------- Yeni hedef --------------------------------- */

export function CreateGoalDialog({
  employeeId,
  employeeName,
  cycle,
  existing,
  onClose,
}: {
  employeeId: string
  employeeName: string
  cycle: ReviewCycle
  existing: Goal[]
  onClose: () => void
}) {
  const toast = useToast()
  const create = useCreateGoal()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState(existing.length ? 20 : 100)
  const [numeric, setNumeric] = useState(true)
  const [target, setTarget] = useState('')
  const [unit, setUnit] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const others = existing.filter((g) => g.status !== 'Cancelled')
  const total = others.reduce((a, g) => a + g.weight, 0) + weight
  const targetNum = parse(target)
  const errs = {
    title: !title.trim() ? 'Hedefe bir başlık verin.' : undefined,
    target: numeric && (targetNum === null || targetNum <= 0) ? 'Sıfırdan büyük bir hedef değer girin.' : undefined,
  }

  const submit = () => {
    setTouched(true)
    if (errs.title || errs.target) return
    create.mutate(
      {
        cycleId: cycle.id,
        employeeId,
        title: title.trim(),
        description: description.trim() || undefined,
        weight,
        ...(numeric ? { targetValue: targetNum!, unit: unit.trim() || undefined } : {}),
      },
      {
        onSuccess: () => {
          toast.ok(`«${title.trim()}» hedefi ${employeeName} için eklendi.`)
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
      title="Yeni hedef"
      note={`${employeeName} · ${cycle.name}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Ekleniyor…' : 'Hedefi ekle'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <div className="flex flex-col gap-4">
        <TextField label="Başlık" value={title} onChange={(e) => setTitle(e.target.value)} error={touched ? errs.title : undefined} placeholder="ör. Ödeme servisi v2 lansmanı" autoFocus required />
        <TextAreaField label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Başarının tanımı ne?" />

        <div className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium">Ağırlık</p>
              <p className="text-[12px] text-muted-foreground">Oransal — hedeflerin toplamına göre yüzdeye çevrilir.</p>
            </div>
            <NumberStepper value={weight} onChange={setWeight} min={1} max={100} step={5} ariaLabel="Hedef ağırlığı" />
          </div>
          <ShareBar
            className="mt-3"
            items={[...others.map((g) => ({ id: g.id, label: g.title, weight: g.weight })), { id: '__new__', label: title.trim() || 'Yeni hedef', weight, color: 'hsl(var(--primary))' }]}
            color="hsl(var(--muted-foreground))"
            highlightId="__new__"
            height={10}
          />
          <p className="mt-2 text-[12px]">
            Bu hedef, {employeeName} için bu dönemin hedeflerinin{' '}
            <span className="tabular font-semibold text-primary">{formatShareOf(shareOf(weight, total))}</span> olur.
          </p>
        </div>

        <Switch
          checked={numeric}
          onChange={setNumeric}
          label="Sayısal hedef"
          hint={numeric ? 'İlerleme gerçekleşen / hedef değerden hesaplanır; %100’de kırpılır.' : 'Sayısal değer yoksa ilerleme durumdan gelir: Gerçekleşti %100, Devam ediyor %50, Gerçekleşmedi %0.'}
        />
        <AnimatePresence initial={false}>
          {numeric && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
                <TextField label="Hedef değer" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} error={touched ? errs.target : undefined} placeholder="ör. 80" className="tabular" />
                <TextField label="Birim" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, adet, ₺…" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}

/* ------------------------------ İlerleme güncelle ------------------------------ */

export function ProgressDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const toast = useToast()
  const update = useUpdateGoalProgress()
  const numeric = goal.targetValue !== null && goal.targetValue > 0
  const [current, setCurrent] = useState(goal.currentValue !== null ? String(goal.currentValue).replace('.', ',') : '')
  const [status, setStatus] = useState<GoalStatus>(goal.status)
  const [error, setError] = useState<string | null>(null)

  const currentNum = parse(current)
  const preview = progressOf({ targetValue: goal.targetValue, currentValue: numeric ? currentNum : null, status })
  const invalid = numeric && (currentNum === null || currentNum < 0)

  const submit = () => {
    if (invalid) return
    update.mutate(
      { id: goal.id, input: { ...(numeric ? { currentValue: currentNum! } : {}), ...(status !== goal.status ? { status } : {}) } },
      {
        onSuccess: () => {
          toast.ok(`«${goal.title}» güncellendi.`)
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
      title="İlerlemeyi güncelle"
      note={goal.title}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={update.isPending || invalid}>
            {update.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <div className="flex flex-col gap-4">
        {numeric && (
          <TextField
            label={`Gerçekleşen (hedef: ${formatGoalValue(goal.targetValue, goal.unit)})`}
            inputMode="decimal"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={invalid ? 'Sıfır ya da daha büyük bir değer girin.' : undefined}
            autoFocus
            className="tabular"
          />
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">Durum</p>
          <Segmented ariaLabel="Hedef durumu" size="sm" value={status} onChange={setStatus} options={GOAL_STATUSES.map((s) => ({ value: s, label: goalStatusLabels[s] }))} />
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <div className="mb-1.5 flex justify-between text-[12px]">
            <span className="text-muted-foreground">Puana yansıyan ilerleme</span>
            <span className="tabular font-semibold">{preview.pct === null ? 'hesaba girmez' : `%${Math.round(preview.pct)}`}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-muted">
            <motion.div className="h-full rounded-full bg-primary" animate={{ width: `${preview.pct ?? 0}%` }} transition={{ type: 'spring', stiffness: 260, damping: 30 }} />
          </div>
          {numeric && (preview.raw ?? 0) > 100 && (
            <p className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-[hsl(var(--success))]">
              <Flame className="size-3.5" aria-hidden />
              %{Math.round(preview.raw ?? 0)} gerçekleşme — fazlası puana yansımaz, çubuk %100'de durur.
            </p>
          )}
          {!numeric && <p className="mt-2 text-[12px] text-muted-foreground">Sayısal hedef olmadığı için ilerleme durumdan hesaplanır.</p>}
        </div>
      </div>
    </Modal>
  )
}
