/**
 * Desenler: şirketin kendi vardiya döngülerini tanımladığı yer.
 *
 * Desen, art arda dizilmiş günlerden oluşan bir döngüdür (ör. 3 gece →
 * 3 tatil → 3 gündüz). İzin ve resmî tatil gibi istisnalar desene YAZILMAZ —
 * onlar takvimde override olarak desenin üzerine biner.
 */

import { useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  LoaderCircle,
  Plus,
  Repeat,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import {
  useCreateShiftPattern,
  useDeleteShiftPattern,
  useShiftPatterns,
  useShiftTeams,
} from '@/api/queries-shift-engine'
import type { ShiftDayType, ShiftPattern, ShiftPatternDayInput } from '@/api/timeshift'
import { useAuth } from '@/auth/useAuth'
import { Modal } from '@/components/ui/Modal'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { EmptyState, ErrorState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/Toast'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ApiError } from '@/api/client'
import { Segmented, errorText } from '@/features/performance/components/controls'
import {
  DAY_STYLE,
  DayBlock,
  Legend,
  PATTERN_TYPES,
  PatternStrip,
  describeDays,
  durationLabel,
  hhmm,
  sortedDays,
  timeRange,
} from './shared'

/* --------------------------------- Yardımcılar --------------------------------- */

type DraftDay = ShiftPatternDayInput

const DEFAULT_TIMES: Record<Exclude<ShiftDayType, 'Off'>, { start: string; end: string }> = {
  Day: { start: '09:00', end: '21:00' },
  Night: { start: '21:00', end: '09:00' },
}

const MAX_DAYS = 62

const makeDay = (type: ShiftDayType, times = DEFAULT_TIMES): DraftDay =>
  type === 'Off'
    ? { type, startTime: null, endTime: null }
    : { type, startTime: times[type].start, endTime: times[type].end }

const repeat = (type: ShiftDayType, n: number, times = DEFAULT_TIMES) =>
  Array.from({ length: n }, () => makeDay(type, times))

const PRESETS: Array<{ key: string; label: string; days: () => DraftDay[] }> = [
  {
    key: '3-3-3',
    label: '3 gece · 3 tatil · 3 gündüz',
    days: () => [...repeat('Night', 3), ...repeat('Off', 3), ...repeat('Day', 3)],
  },
  {
    key: '2-2-4',
    label: '2 gündüz · 2 gece · 4 tatil',
    days: () => [...repeat('Day', 2), ...repeat('Night', 2), ...repeat('Off', 4)],
  },
  {
    key: '5-2',
    label: '5 gündüz · 2 tatil',
    days: () => [...repeat('Day', 5, { ...DEFAULT_TIMES, Day: { start: '08:30', end: '17:30' } }), ...repeat('Off', 2)],
  },
]

/** "3 Gece / 3 Tatil / 3 Gündüz" */
function suggestName(days: DraftDay[]): string {
  return describeDays(days)
    .split(' → ')
    .map((part) => part.replace(/ (\p{L})/u, (_, c: string) => ` ${c.toLocaleUpperCase('tr-TR')}`))
    .join(' / ')
}

/** Haftalık ortalama çalışma saati — döngü haftaya tam bölünmese de karşılaştırılabilir. */
function weeklyHours(days: Array<{ startTime: string | null; endTime: string | null }>): number {
  if (days.length === 0) return 0
  const minutes = days.reduce((sum, d) => {
    if (!d.startTime || !d.endTime) return sum
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    let m = toMin(d.endTime) - toMin(d.startTime)
    if (m <= 0) m += 24 * 60
    return sum + m
  }, 0)
  return (minutes / 60 / days.length) * 7
}

const hoursText = (h: number) => `${h.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sa`

/* ------------------------------- Desen oluşturucu ------------------------------- */

function PatternBuilderDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const create = useCreateShiftPattern()

  const [days, setDays] = useState<DraftDay[]>(() => PRESETS[0].days())
  const [selected, setSelected] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  // "Blok ekle" satırı
  const [blockType, setBlockType] = useState<ShiftDayType>('Day')
  const [blockCount, setBlockCount] = useState(3)
  const [times, setTimes] = useState(DEFAULT_TIMES)

  const effectiveName = nameTouched ? name : suggestName(days)

  const dayErrors = days.map((d) => {
    if (d.type === 'Off') return null
    if (!d.startTime || !d.endTime) return 'Başlangıç ve bitiş saati gerekli.'
    if (d.startTime === d.endTime) return 'Başlangıç ve bitiş aynı olamaz.'
    return null
  })
  const firstBadDay = dayErrors.findIndex(Boolean)
  const errors = {
    name: !effectiveName.trim() ? 'Desene bir ad verin.' : undefined,
    days:
      days.length === 0
        ? 'En az bir gün ekleyin.'
        : days.every((d) => d.type === 'Off')
          ? 'Desende en az bir çalışma günü (gündüz ya da gece) olmalı.'
          : firstBadDay >= 0
            ? `${firstBadDay + 1}. gün: ${dayErrors[firstBadDay]}`
            : undefined,
  }
  const valid = !errors.name && !errors.days

  const update = (i: number, patch: Partial<DraftDay>) =>
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  const setType = (i: number, type: ShiftDayType) =>
    setDays((prev) =>
      prev.map((d, j) => {
        if (j !== i) return d
        if (type === 'Off') return makeDay('Off')
        // Tip değişince o tipin son kullanılan saatleri gelsin; aynı tipse saat korunur.
        return d.type === type ? d : makeDay(type, times)
      }),
    )

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= days.length) return
    setDays((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setSelected(j)
  }

  const duplicate = (i: number) => {
    if (days.length >= MAX_DAYS) return
    setDays((prev) => [...prev.slice(0, i + 1), { ...prev[i] }, ...prev.slice(i + 1)])
    setSelected(i + 1)
  }

  const remove = (i: number) => {
    setDays((prev) => prev.filter((_, j) => j !== i))
    setSelected(null)
  }

  const addBlock = () => {
    const room = MAX_DAYS - days.length
    const n = Math.max(0, Math.min(blockCount, room))
    if (n === 0) return
    setDays((prev) => [...prev, ...repeat(blockType, n, times)])
    setSelected(null)
  }

  const submit = () => {
    setSubmitted(true)
    if (!valid) return
    create.mutate(
      {
        name: effectiveName.trim(),
        days: days.map((d) =>
          d.type === 'Off'
            ? { type: 'Off', startTime: null, endTime: null }
            : { type: d.type, startTime: hhmm(d.startTime), endTime: hhmm(d.endTime) },
        ),
      },
      {
        onSuccess: (p) => {
          toast.ok(`"${p?.name ?? effectiveName.trim()}" deseni oluşturuldu.`)
          onClose()
        },
      },
    )
  }

  const sel = selected !== null ? days[selected] : null
  const weekly = weeklyHours(days)

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="Yeni vardiya deseni"
      note="Döngüyü gün gün kurun. Ekip, başlangıç tarihinden itibaren bu diziyi sırayla takip eder ve sona gelince başa döner."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Deseni kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {create.isError && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {errorText(create.error, 'Desen kaydedilemedi.')}
          </p>
        )}

        {/* Hazır başlangıçlar */}
        <div>
          <p className="mb-2 text-[13px] font-medium">Hazır bir döngüden başlayın</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button
                key={p.key}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setDays(p.days())
                  setSelected(null)
                }}
              >
                {p.label}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDays([])
                setSelected(null)
              }}
            >
              Boş başla
            </Button>
          </div>
        </div>

        {/* Şerit */}
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-medium">
              Döngü
              <span className="ml-2 font-normal text-muted-foreground tabular">
                {days.length > 0 ? `${formatNumber(days.length)} gün` : 'boş'}
              </span>
            </p>
            {days.length > 0 && (
              <p className="text-[12px] text-muted-foreground">
                {describeDays(days)} · haftalık ort. {hoursText(weekly)}
              </p>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3">
            {days.length === 0 ? (
              <p className="py-4 text-center text-[13px] text-muted-foreground">
                Henüz gün yok. Aşağıdan blok ekleyin ya da hazır bir döngü seçin.
              </p>
            ) : (
              <ol className="flex flex-wrap gap-1.5" aria-label="Desen günleri">
                {days.map((d, i) => {
                  const bad = submitted && Boolean(dayErrors[i])
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => setSelected(selected === i ? null : i)}
                        aria-pressed={selected === i}
                        aria-label={`${i + 1}. gün, ${DAY_STYLE[d.type].label}${d.startTime ? ` ${timeRange(d.startTime, d.endTime)}` : ''}`}
                        className={cn(
                          'group flex cursor-pointer flex-col items-center gap-1 rounded-md p-1 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                          selected === i ? 'bg-background shadow-sm ring-2 ring-primary' : 'hover:bg-background',
                          bad && 'ring-2 ring-destructive',
                        )}
                      >
                        <DayBlock type={d.type} size="md" />
                        <span className="tabular text-[10px] leading-none text-muted-foreground">{i + 1}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
          {submitted && errors.days && (
            <p role="alert" className="mt-1.5 text-[12px] text-destructive">
              {errors.days}
            </p>
          )}
        </div>

        {/* Seçili gün düzenleyici */}
        {sel && selected !== null && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">{selected + 1}. gün</p>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" variant="ghost" onClick={() => move(selected, -1)} disabled={selected === 0} aria-label="Sola taşı">
                  <ArrowLeft className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => move(selected, 1)} disabled={selected === days.length - 1} aria-label="Sağa taşı">
                  <ArrowRight className="size-4" />
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => duplicate(selected)} disabled={days.length >= MAX_DAYS}>
                  <Copy className="size-4" /> Çoğalt
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => remove(selected)}>
                  <Trash2 className="size-4" /> Sil
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Tip</span>
                <Segmented
                  ariaLabel="Gün tipi"
                  value={sel.type}
                  onChange={(t) => setType(selected, t)}
                  options={PATTERN_TYPES.map((t) => ({ value: t, label: DAY_STYLE[t].label }))}
                />
              </div>
              {sel.type !== 'Off' && (
                <>
                  <TextField
                    label="Başlangıç"
                    type="time"
                    className="w-32"
                    value={hhmm(sel.startTime)}
                    onChange={(e) => update(selected, { startTime: e.target.value || null })}
                  />
                  <TextField
                    label="Bitiş"
                    type="time"
                    className="w-32"
                    value={hhmm(sel.endTime)}
                    onChange={(e) => update(selected, { endTime: e.target.value || null })}
                  />
                  <p className="pb-2 text-[12px] text-muted-foreground">
                    {durationLabel(sel.startTime, sel.endTime)}
                    {sel.startTime && sel.endTime && hhmm(sel.endTime) <= hhmm(sel.startTime) && ' · ertesi gün biter'}
                  </p>
                </>
              )}
            </div>
            {dayErrors[selected] && <p className="mt-2 text-[12px] text-destructive">{dayErrors[selected]}</p>}
          </div>
        )}

        {/* Blok ekle */}
        <div className="rounded-lg border border-border p-3">
          <p className="mb-3 text-[13px] font-medium">Sona blok ekle</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px]">Tip</span>
              <Segmented
                ariaLabel="Eklenecek gün tipi"
                value={blockType}
                onChange={setBlockType}
                options={PATTERN_TYPES.map((t) => ({ value: t, label: DAY_STYLE[t].label }))}
              />
            </div>
            <TextField
              label="Gün sayısı"
              type="number"
              min={1}
              max={31}
              className="tabular w-24"
              value={blockCount}
              onChange={(e) => setBlockCount(Math.max(1, Math.min(31, Number(e.target.value) || 1)))}
            />
            {blockType !== 'Off' && (
              <>
                <TextField
                  label="Başlangıç"
                  type="time"
                  className="w-32"
                  value={times[blockType].start}
                  onChange={(e) => setTimes((t) => ({ ...t, [blockType]: { ...t[blockType], start: e.target.value } }))}
                />
                <TextField
                  label="Bitiş"
                  type="time"
                  className="w-32"
                  value={times[blockType].end}
                  onChange={(e) => setTimes((t) => ({ ...t, [blockType]: { ...t[blockType], end: e.target.value } }))}
                />
              </>
            )}
            <Button type="button" variant="secondary" onClick={addBlock} disabled={days.length >= MAX_DAYS}>
              <Plus className="size-4" />
              {blockCount} gün ekle
            </Button>
          </div>
          {days.length >= MAX_DAYS && (
            <p className="mt-2 text-[12px] text-muted-foreground">Bir desen en fazla {MAX_DAYS} gün olabilir.</p>
          )}
        </div>

        <TextField
          label="Desen adı"
          value={effectiveName}
          onChange={(e) => {
            setNameTouched(true)
            setName(e.target.value)
          }}
          hint={nameTouched ? undefined : 'Döngüden otomatik önerildi; dilediğiniz gibi değiştirebilirsiniz.'}
          error={submitted ? errors.name : undefined}
          maxLength={120}
        />
      </div>
    </Modal>
  )
}

/* ---------------------------------- Silme onayı --------------------------------- */

function DeletePatternDialog({ pattern, usedBy, onClose }: { pattern: ShiftPattern; usedBy: string[]; onClose: () => void }) {
  const toast = useToast()
  const del = useDeleteShiftPattern()
  const conflict = del.error instanceof ApiError && del.error.status === 409

  return (
    <Modal
      open
      onClose={onClose}
      title="Desen silinsin mi?"
      note={`"${pattern.name}" kalıcı olarak silinir.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button
            variant="destructive"
            disabled={del.isPending || usedBy.length > 0}
            onClick={() =>
              del.mutate(pattern.id, {
                onSuccess: () => {
                  toast.ok('Desen silindi.')
                  onClose()
                },
              })
            }
          >
            {del.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Sil
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <PatternStrip days={sortedDays(pattern)} size="sm" />
        {usedBy.length > 0 ? (
          <p className="rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/8 px-3 py-2.5">
            Bu deseni kullanan ekip var: <strong>{usedBy.join(', ')}</strong>. Silmek için önce bu ekiplerin deseni
            kullanmaması gerekir.
          </p>
        ) : (
          <p className="text-muted-foreground">Deseni kullanan ekip yok; silmek mevcut takvimleri etkilemez.</p>
        )}
        {del.isError && (
          <p role="alert" className="text-destructive">
            {conflict
              ? 'Bu desen hâlâ bir ekip tarafından kullanılıyor, silinemedi.'
              : errorText(del.error, 'Desen silinemedi.')}
          </p>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------ Liste ------------------------------------ */

export function PatternsView() {
  const { can } = useAuth()
  const manage = can('timeshift:manage')
  const patterns = useShiftPatterns()
  const teams = useShiftTeams()
  const [building, setBuilding] = useState(false)
  const [deleting, setDeleting] = useState<ShiftPattern | null>(null)

  const usage = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const t of teams.data ?? []) map.set(t.shiftPatternId, [...(map.get(t.shiftPatternId) ?? []), t.name])
    return map
  }, [teams.data])

  const list = useMemo(
    () =>
      [...(patterns.data ?? [])].sort(
        (a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name, 'tr-TR'),
      ),
    [patterns.data],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Legend types={PATTERN_TYPES} />
        {manage && (
          <Button onClick={() => setBuilding(true)}>
            <Plus className="size-4" /> Yeni desen
          </Button>
        )}
      </div>

      <InfoNote>
        Desen yalnızca olağan döngüyü tanımlar. Onaylanan izinler ve resmî tatiller takvimde desenin üzerine
        kendiliğinden işlenir; bunları desene eklemeniz gerekmez.
      </InfoNote>

      {patterns.isPending ? (
        <Panel>
          <RowsSkeleton rows={3} columns={3} />
        </Panel>
      ) : patterns.isError ? (
        <Panel>
          <ErrorState message={errorText(patterns.error)} onRetry={() => void patterns.refetch()} />
        </Panel>
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Repeat}
            title="Henüz vardiya deseni yok"
            detail={
              manage
                ? 'Şirketiniz vardiyalı çalışıyorsa döngüyü burada tanımlayın. Vardiya kullanmıyorsanız bu bölümü boş bırakabilirsiniz.'
                : 'Vardiya desenlerini İK yöneticisi tanımlar.'
            }
            action={
              manage && (
                <Button onClick={() => setBuilding(true)}>
                  <Plus className="size-4" /> İlk deseni oluştur
                </Button>
              )
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => {
            const days = sortedDays(p)
            const usedBy = usage.get(p.id) ?? []
            return (
              <Panel key={p.id} className={cn(!p.isActive && 'opacity-70')}>
                <PanelHead
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {p.name}
                      {!p.isActive && <StatusBadge>Pasif</StatusBadge>}
                    </span>
                  }
                  note={`${formatNumber(days.length)} günlük döngü · ${describeDays(days)}`}
                  action={
                    manage && (
                      <Button size="sm" variant="ghost" aria-label={`${p.name} desenini sil`} onClick={() => setDeleting(p)}>
                        <Trash2 className="size-4" />
                      </Button>
                    )
                  }
                />
                <PanelBody className="space-y-3">
                  <PatternStrip days={days} size="sm" />
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted-foreground">
                    {(['Day', 'Night'] as const).map((t) => {
                      const d = days.find((x) => x.type === t)
                      return d ? (
                        <div key={t} className="flex gap-1.5">
                          <dt>{DAY_STYLE[t].label}</dt>
                          <dd className="tabular text-foreground">{timeRange(d.startTime, d.endTime)}</dd>
                        </div>
                      ) : null
                    })}
                    <div className="flex gap-1.5">
                      <dt>Haftalık ort.</dt>
                      <dd className="tabular text-foreground">{hoursText(weeklyHours(days))}</dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt>Kullanan ekip</dt>
                      <dd className="text-foreground">{usedBy.length ? usedBy.join(', ') : 'yok'}</dd>
                    </div>
                  </dl>
                </PanelBody>
              </Panel>
            )
          })}
        </div>
      )}

      {building && <PatternBuilderDialog onClose={() => setBuilding(false)} />}
      {deleting && (
        <DeletePatternDialog pattern={deleting} usedBy={usage.get(deleting.id) ?? []} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}
