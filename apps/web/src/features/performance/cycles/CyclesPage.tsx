/**
 * Dönem yönetimi — `/panel/performans/donemler`.
 *
 * Her şey döneme bağlı: hedefler, değerlendirmeler, dönemsel analiz.
 * Üstte açık dönem (zaman ilerlemesi + kapanışa hazırlık), altında yıllık
 * zaman çizelgesi ve dönem kartları. Durum yolu tek yönlü:
 * Taslak → Açık → Kapandı. Kapanış özel akıştır (bkz. CloseCycleDialog).
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, CalendarClock, CalendarPlus, CalendarRange, CheckCircle2, Hourglass, Lock, PlayCircle, Sparkles } from 'lucide-react'
import {
  cyclePeriodLabels,
  cycleStatusLabels,
  cycleStatusTone,
  useCycleReadiness,
  useCycles,
  useSetCycleStatus,
  type ReviewCycle,
} from '@/api/performance'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useToast } from '@/components/ui/Toast'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CountUp, EASE } from '@/motion/primitives'
import { Segmented, errorText } from '../components/controls'
import { PerfPageHeader, SetupTrail } from '../components/PerfPageHeader'
import { CloseCycleDialog } from './CloseCycleDialog'
import { CreateCycleDialog } from './CreateCycleDialog'
import { CycleTimeline } from './CycleTimeline'
import { timeProgress } from './cycleDefaults'
import { cycleStatusGroup } from '@/api/performance/labels'

type Filter = 'all' | 'Open' | 'Planned' | 'Closed'

export function CyclesPage() {
  const cycles = useCycles()
  const [creating, setCreating] = useState(false)
  const [closing, setClosing] = useState<ReviewCycle | null>(null)
  const [opening, setOpening] = useState<ReviewCycle | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<string | null>(null)

  const list = useMemo(() => [...(cycles.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)), [cycles.data])
  // InReview de "henuz kapanmamis" sayilir - dogrudan Open kadar aktif kabul edilir.
  const active = list.find((c) => cycleStatusGroup(c.status) === 'open') ?? null
  const years = useMemo(() => [...new Set(list.map((c) => c.year))].sort((a, b) => b - a), [list])
  const [year, setYear] = useState<number | null>(null)
  const shownYear = year ?? (active?.year ?? years[0] ?? new Date().getFullYear())

  const visible = list.filter((c) => (filter === 'all' || c.status === filter) && (filter !== 'all' || c.year === shownYear || years.length <= 1))

  const stats = [
    { label: 'Açık', value: list.filter((c) => cycleStatusGroup(c.status) === 'open').length },
    { label: 'Taslak', value: list.filter((c) => cycleStatusGroup(c.status) === 'planned').length },
    { label: 'Kapanan', value: list.filter((c) => cycleStatusGroup(c.status) === 'closed').length },
  ]

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PerfPageHeader
        eyebrow="Performans kurulumu · 3. adım"
        title="Dönemler"
        description="Hedefler, değerlendirmeler ve dönemsel sonuçlar döneme bağlıdır. Dönem taslak olarak oluşturulur, açılır ve özel bir akışla kapatılır; kapanan dönem yeniden açılamaz."
        actions={
          <Button onClick={() => setCreating(true)} disabled={cycles.isPending}>
            <CalendarPlus aria-hidden />
            Yeni dönem
          </Button>
        }
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <SetupTrail current="cycles" />
          <dl className="grid max-w-xs grid-cols-3 gap-4 sm:gap-6">
            {stats.map((s, i) => (
              <div key={s.label}>
                <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
                <dd className="text-[20px] leading-tight font-semibold">
                  {cycles.isPending ? <Skeleton className="mt-1 h-5 w-6" /> : <CountUp to={s.value} duration={0.8} delay={0.08 * i} />}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </PerfPageHeader>

      {cycles.isError && (
        <Panel>
          <ErrorState title="Dönemler alınamadı" message={errorText(cycles.error)} onRetry={() => void cycles.refetch()} />
        </Panel>
      )}

      {cycles.isPending && (
        <div className="flex flex-col gap-5" aria-busy="true">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-32 w-full rounded-2xl" />
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {!cycles.isPending && !cycles.isError && list.length === 0 && (
        <Panel>
          <EmptyState
            icon={CalendarRange}
            title="Henüz dönem yok — ilk dönemi oluşturun"
            detail="Hedefler ve değerlendirmeler bir döneme bağlanmadan başlatılamaz. Çoğu şirket çeyreklik dönemle başlar."
            action={
              <Button onClick={() => setCreating(true)}>
                <CalendarPlus aria-hidden />
                Yeni dönem
              </Button>
            }
          />
        </Panel>
      )}

      {list.length > 0 && (
        <div className="flex flex-col gap-5">
          {active ? <ActiveCycleCard cycle={active} onClose={() => setClosing(active)} /> : <NoActiveCycle drafts={list.filter((c) => c.status === 'Planned')} onOpen={setOpening} onCreate={() => setCreating(true)} />}

          {/* zaman çizelgesi */}
          <Panel className="p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold">{shownYear} zaman çizelgesi</h2>
                <p className="text-[12px] text-muted-foreground">Çakışan dönemler ayrı şeritte gösterilir. Bir döneme tıklayınca kartına gidersiniz.</p>
              </div>
              {years.length > 1 && (
                <Segmented ariaLabel="Yıl" size="sm" value={String(shownYear)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
              )}
            </div>
            <CycleTimeline
              year={shownYear}
              cycles={list}
              selectedId={selected}
              onSelect={(c) => {
                setSelected(c.id)
                setFilter('all')
                document.getElementById(`cycle-${c.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}
            />
            <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded bg-primary" />Açık</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded border border-dashed border-primary/50 bg-primary/5" />Taslak</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded border border-border bg-muted" />Kapandı</span>
            </div>
          </Panel>

          {/* kartlar */}
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold">Dönemler</h2>
              <Segmented
                ariaLabel="Durum"
                size="sm"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: years.length > 1 ? `${shownYear}` : 'Tümü' },
                  { value: 'Open', label: 'Açık' },
                  { value: 'Planned', label: 'Taslak' },
                  { value: 'Closed', label: 'Kapanan' },
                ]}
              />
            </div>
            {visible.length === 0 ? (
              <Panel>
                <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">Bu filtrede dönem yok.</p>
              </Panel>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <AnimatePresence initial={false}>
                  {visible.map((c, i) => (
                    <CycleCard key={c.id} cycle={c} index={i} highlighted={c.id === selected} onOpen={() => setOpening(c)} onClose={() => setClosing(c)} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      )}

      {creating && <CreateCycleDialog cycles={list} onClose={() => setCreating(false)} />}
      {closing && <CloseCycleDialog cycle={closing} onClose={() => setClosing(null)} />}
      {opening && <OpenCycleDialog cycle={opening} hasActive={Boolean(active)} onClose={() => setOpening(null)} />}
    </div>
  )
}

/* ---------------------------------- açık dönem ---------------------------------- */

function ActiveCycleCard({ cycle, onClose }: { cycle: ReviewCycle; onClose: () => void }) {
  const readiness = useCycleReadiness(cycle.id)
  const t = timeProgress(cycle)
  const r = readiness.data
  const total = r ? r.readyCount + r.provisionalCount : 0
  const readyPct = total ? r!.readyCount / total : 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: EASE }}
      className="relative overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-sm"
      aria-labelledby="active-cycle"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="hr-aurora absolute -top-24 right-10 h-56 w-72 rounded-full bg-primary/10 blur-3xl" />
      </div>
      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[12px] font-semibold text-primary">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
              <span className="relative size-2 rounded-full bg-primary" />
            </span>
            Açık dönem
          </p>
          <h2 id="active-cycle" className="mt-1 text-[24px] font-semibold tracking-tight">
            {cycle.name}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {cyclePeriodLabels[cycle.period]} · {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
          </p>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Dönem ilerlemesi</span>
              <span className="tabular font-medium">
                %{Math.round(t.pct * 100)} · {t.ended ? 'süre doldu, kapanmayı bekliyor' : `${t.daysLeft} gün kaldı`}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary to-[hsl(var(--chart-2))]"
                initial={{ width: 0 }}
                animate={{ width: `${t.pct * 100}%` }}
                transition={{ duration: 1.2, ease: EASE, delay: 0.2 }}
              />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="destructive" onClick={onClose}>
              <Lock aria-hidden />
              Dönemi kapat
            </Button>
            <Button asChild variant="outline">
              <Link to="/panel/performans/degerlendirme">Değerlendirmeler</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link to="/panel/performans/hedefler">
                Hedefler
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-background/60 p-4 backdrop-blur-sm">
          <p className="text-[12px] font-semibold text-muted-foreground">Kapanışa hazırlık</p>
          {readiness.isPending ? (
            <div className="mt-3 flex items-center gap-4">
              <Skeleton className="size-20 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </div>
          ) : r ? (
            <div className="mt-3 flex items-center gap-4">
              <ReadyRing pct={readyPct} />
              <dl className="flex-1 space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CheckCircle2 className="size-3.5 text-[hsl(var(--success))]" aria-hidden />
                    Hazır
                  </dt>
                  <dd className="tabular font-semibold">{r.readyCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <Hourglass className="size-3.5 text-[hsl(var(--warning))]" aria-hidden />
                    Geçici kalacak
                  </dt>
                  <dd className="tabular font-semibold">{r.provisionalCount}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarClock className="size-3.5 text-primary" aria-hidden />
                    Bekleyen değerlendirme
                  </dt>
                  <dd className="tabular font-semibold">{r.pendingReviewTotal}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">{errorText(readiness.error, 'Hazırlık bilgisi alınamadı.')}</p>
          )}
        </div>
      </div>
    </motion.section>
  )
}

function ReadyRing({ pct }: { pct: number }) {
  const r = 32
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 80 80" className="size-20 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth="8" />
        <motion.circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="hsl(var(--success))"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-[15px] font-semibold">%{Math.round(pct * 100)}</span>
    </div>
  )
}

function NoActiveCycle({ drafts, onOpen, onCreate }: { drafts: ReviewCycle[]; onOpen: (c: ReviewCycle) => void; onCreate: () => void }) {
  const next = [...drafts].sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  return (
    <Panel className="border-dashed p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-[15px] font-semibold">Şu an açık dönem yok</p>
            <p className="text-[13px] text-muted-foreground">
              {next ? `Sıradaki taslak: ${next.name}. Açtığınızda değerlendirmeler başlatılabilir.` : 'Değerlendirme başlatmak için bir dönem oluşturup açın.'}
            </p>
          </div>
        </div>
        {next ? (
          <Button onClick={() => onOpen(next)}>
            <PlayCircle aria-hidden />
            {next.name} dönemini aç
          </Button>
        ) : (
          <Button onClick={onCreate}>
            <CalendarPlus aria-hidden />
            Yeni dönem
          </Button>
        )}
      </div>
    </Panel>
  )
}

/* ---------------------------------- dönem kartı ---------------------------------- */

function CycleCard({
  cycle,
  index,
  highlighted,
  onOpen,
  onClose,
}: {
  cycle: ReviewCycle
  index: number
  highlighted: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const t = timeProgress(cycle)
  return (
    <motion.article
      id={`cycle-${cycle.id}`}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.45, ease: EASE, delay: Math.min(index, 8) * 0.05 }}
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4 transition-shadow hover:shadow-md',
        cycle.status === 'Open' ? 'border-primary/40' : cycle.status === 'Planned' ? 'border-dashed border-border' : 'border-border',
        highlighted && 'ring-2 ring-primary/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold">{cycle.name}</h3>
          <p className="text-[12px] text-muted-foreground">
            {cyclePeriodLabels[cycle.period]} · {formatDate(cycle.startDate)} – {formatDate(cycle.endDate)}
          </p>
        </div>
        <StatusBadge tone={cycleStatusTone[cycle.status]}>{cycleStatusLabels[cycle.status]}</StatusBadge>
      </div>

      {cycle.status === 'Closed' && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {cycle.finalizedEmployeeCount !== null && cycle.finalizedEmployeeCount !== undefined
            ? `${cycle.finalizedEmployeeCount} çalışanın nihai puanı sabitlendi`
            : 'Puanlar sabitlendi'}
          {cycle.closedAt && ` · ${formatDateTime(cycle.closedAt)}`}
        </p>
      )}
      {cycle.status === 'Planned' && (
        <p className="text-[12px] text-muted-foreground">
          {t.started ? 'Başlangıç tarihi geçti; açılmayı bekliyor.' : `${t.daysToStart} gün sonra başlıyor.`} Taslakken değerlendirme başlatılamaz.
        </p>
      )}
      {cycle.status === 'Open' && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <motion.div className="h-full rounded-full bg-primary" initial={{ width: 0 }} animate={{ width: `${t.pct * 100}%` }} transition={{ duration: 1, ease: EASE }} />
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {cycle.status === 'Planned' && (
          <Button size="sm" onClick={onOpen}>
            <PlayCircle aria-hidden />
            Dönemi aç
          </Button>
        )}
        {cycle.status === 'Open' && (
          <Button size="sm" variant="destructive" onClick={onClose}>
            <Lock aria-hidden />
            Dönemi kapat
          </Button>
        )}
        {cycle.status !== 'Planned' && (
          <Button asChild size="sm" variant="outline">
            <Link to={`/panel/performans/analiz?sekme=donem&donem=${cycle.id}`}>Sonuçlar</Link>
          </Button>
        )}
      </div>
    </motion.article>
  )
}

/* ---------------------------------- dönemi aç ---------------------------------- */

function OpenCycleDialog({ cycle, hasActive, onClose }: { cycle: ReviewCycle; hasActive: boolean; onClose: () => void }) {
  const toast = useToast()
  const setStatus = useSetCycleStatus()
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      onClose={onClose}
      title={`${cycle.name} açılsın mı?`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={setStatus.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() =>
              setStatus.mutate(
                { id: cycle.id, status: 'Open' },
                {
                  onSuccess: () => {
                    toast.ok(`${cycle.name} açıldı. Değerlendirmeler başlatılabilir.`)
                    onClose()
                  },
                  onError: (e) => setError(errorText(e)),
                },
              )
            }
            disabled={setStatus.isPending}
          >
            <PlayCircle aria-hidden />
            {setStatus.isPending ? 'Açılıyor…' : 'Dönemi aç'}
          </Button>
        </>
      }
    >
      <ul className="flex flex-col gap-2 text-[13px] text-muted-foreground">
        <li>• Açık dönemde değerlendirme başlatılır ve hedef ilerlemesi güncellenir.</li>
        <li>• Açılan dönem taslağa geri alınamaz; işi bitince kapanış akışıyla kapatılır.</li>
        {hasActive && <li className="text-[hsl(var(--warning))]">• Şu an başka bir açık dönem var. İkisi aynı anda açık kalabilir; raporlarda karışıklığa dikkat edin.</li>}
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </Modal>
  )
}
