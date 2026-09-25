/**
 * Vardiya motorunun ortak parçaları: tarih aritmetiği, gün tiplerinin görsel
 * dili (renk + ikon + ad) ve desen şeridi.
 *
 * Tarihler her yerde "YYYY-MM-DD" metni olarak dolaşır ve UTC üzerinden
 * hesaplanır — yaz saati ya da tarayıcı saat dilimi bir günü kaydırmasın.
 */

import type { ReactNode } from 'react'
import { BedDouble, Flag, Moon, PenLine, TreePalm, Sun } from 'lucide-react'
import type {
  RosterDay,
  RosterDayType,
  ShiftDayType,
  ShiftPattern,
  ShiftPatternDay,
} from '@/api/timeshift'
import { cn } from '@/lib/utils'

/* ------------------------------------ Tarih ------------------------------------ */

const DAY_MS = 86_400_000

const toUtc = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * DAY_MS)

/** `b - a`, gün cinsinden. */
export const diffDays = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS)

/** Yerel takvime göre bugün. */
export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 0 = Pazar … 6 = Cumartesi */
export const weekdayOf = (iso: string) => new Date(toUtc(iso)).getUTCDay()

export const isWeekend = (iso: string) => {
  const w = weekdayOf(iso)
  return w === 0 || w === 6
}

/** Haftanın pazartesisi. */
export const mondayOf = (iso: string) => addDays(iso, -((weekdayOf(iso) + 6) % 7))

export const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`

export function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return fromUtc(Date.UTC(y, m, 0))
}

export function dateRange(from: string, to: string): string[] {
  const n = diffDays(from, to)
  return Array.from({ length: Math.max(0, n + 1) }, (_, i) => addDays(from, i))
}

const WEEKDAY_SHORT = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
export const weekdayShort = (iso: string) => WEEKDAY_SHORT[weekdayOf(iso)]

const dayMonthFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longFmt = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'long',
  weekday: 'long',
  timeZone: 'UTC',
})
const monthFmt = new Intl.DateTimeFormat('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const formatDayMonth = (iso: string) => dayMonthFmt.format(toUtc(iso))
export const formatLongDay = (iso: string) => longFmt.format(toUtc(iso))
export const formatMonth = (iso: string) => monthFmt.format(toUtc(iso))

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Ekibin verilen tarihte desenin kaçıncı gününde olduğu (0 tabanlı). */
export const patternIndexAt = (anchorDate: string, date: string, length: number) =>
  length > 0 ? mod(diffDays(anchorDate, date), length) : 0

/* ------------------------------------ Saat ------------------------------------- */

/** "21:00:00" → "21:00" */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

/** Bitiş başlangıçtan önce (ya da eşit) ise vardiya ertesi güne taşar. */
export const crossesMidnight = (start: string | null, end: string | null) =>
  Boolean(start && end && hhmm(end) <= hhmm(start))

export function timeRange(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  return `${hhmm(start)}–${hhmm(end)}${crossesMidnight(start, end) ? ' (+1)' : ''}`
}

/** Vardiya süresi, dakika cinsinden; gece yarısını geçen vardiyada ertesi güne taşar. */
export function shiftMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  const minutes = toMin(end) - toMin(start)
  return minutes <= 0 ? minutes + 24 * 60 : minutes
}

export const hoursLabel = (minutes: number) =>
  `${(minutes / 60).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} sa`

/** Vardiya süresi, saat cinsinden ("12 sa", "7,5 sa"). */
export function durationLabel(start: string | null, end: string | null): string {
  if (!start || !end) return ''
  return hoursLabel(shiftMinutes(start, end))
}

/* ------------------------------- Gün tiplerinin dili ------------------------------- */

interface DayStyle {
  label: string
  /** Sayılı özetlerde küçük harfli ad ("3 gece"). */
  lower: string
  icon: React.ElementType
  /** Blok zemini + yazı rengi. */
  block: string
  /** Lejant ve sayaç noktası. */
  dot: string
}

export const DAY_STYLE: Record<RosterDayType, DayStyle> = {
  Day: {
    label: 'Gündüz',
    lower: 'gündüz',
    icon: Sun,
    block: 'bg-[hsl(var(--chart-4))]/18 text-[hsl(var(--chart-4))] ring-[hsl(var(--chart-4))]/35',
    dot: 'bg-[hsl(var(--chart-4))]',
  },
  Night: {
    label: 'Gece',
    lower: 'gece',
    icon: Moon,
    block: 'bg-[hsl(var(--chart-1))]/18 text-[hsl(var(--chart-1))] ring-[hsl(var(--chart-1))]/35',
    dot: 'bg-[hsl(var(--chart-1))]',
  },
  Off: {
    label: 'Tatil',
    lower: 'tatil',
    icon: BedDouble,
    block: 'bg-muted text-muted-foreground/70 ring-border',
    dot: 'bg-muted-foreground/40',
  },
  Leave: {
    label: 'İzinli',
    lower: 'izinli',
    icon: TreePalm,
    // Çizgili zemin: istisna olduğu renkten başka bir işaretle de anlaşılsın.
    block:
      'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))] ring-[hsl(var(--success))]/45 bg-[repeating-linear-gradient(135deg,transparent_0_4px,hsl(var(--success)/0.14)_4px_8px)]',
    dot: 'bg-[hsl(var(--success))]',
  },
  Holiday: {
    label: 'Resmî tatil',
    lower: 'resmî tatil',
    icon: Flag,
    block:
      'bg-[hsl(var(--chart-5))]/14 text-[hsl(var(--chart-5))] ring-[hsl(var(--chart-5))]/45 bg-[repeating-linear-gradient(135deg,transparent_0_4px,hsl(var(--chart-5)/0.12)_4px_8px)]',
    dot: 'bg-[hsl(var(--chart-5))]',
  },
  Manual: {
    label: 'Elle değişiklik',
    lower: 'elle değişiklik',
    icon: PenLine,
    block:
      'bg-[hsl(var(--chart-2))]/14 text-[hsl(var(--chart-2))] ring-[hsl(var(--chart-2))]/45 bg-[repeating-linear-gradient(135deg,transparent_0_4px,hsl(var(--chart-2)/0.12)_4px_8px)]',
    dot: 'bg-[hsl(var(--chart-2))]',
  },
}

export const PATTERN_TYPES: ShiftDayType[] = ['Day', 'Night', 'Off']
export const OVERRIDE_TYPES: RosterDayType[] = ['Leave', 'Holiday', 'Manual']

/** Bilinmeyen bir tip gelirse (backend genişlerse) takvim çökmesin. */
export const styleOf = (type: string | null): DayStyle =>
  type === null ? DAY_STYLE.Off : DAY_STYLE[type as RosterDayType] ?? DAY_STYLE.Manual

export const isOverride = (type: string | null) =>
  type === 'Leave' || type === 'Holiday' || type === 'Manual'

/** Takvim hücresinin açıklaması (title / ekran okuyucu). Üyeliğin henüz
 * başlamadığı/bittiği günlerde `type` null gelir — boş hücre. */
export function describeRosterDay(day: RosterDay): string {
  if (day.type === null) return 'Üyelik dışı'
  const s = styleOf(day.type)
  if (day.startTime) return `${s.label} ${timeRange(day.startTime, day.endTime!)}`
  if (day.note) return `${s.label} · ${day.note}`
  return s.label
}

/** "3 gece → 3 tatil → 3 gündüz" — art arda aynı tipler tek grup sayılır. */
export function describeDays(days: Array<{ type: ShiftDayType }>): string {
  const runs: Array<{ type: ShiftDayType; count: number }> = []
  for (const d of days) {
    const last = runs[runs.length - 1]
    if (last && last.type === d.type) last.count++
    else runs.push({ type: d.type, count: 1 })
  }
  return runs.map((r) => `${r.count} ${DAY_STYLE[r.type].lower}`).join(' → ')
}

export const sortedDays = (p: Pick<ShiftPattern, 'days'>): ShiftPatternDay[] =>
  [...(p.days ?? [])].sort((a, b) => a.dayIndex - b.dayIndex)

/* ----------------------------------- Bileşenler ---------------------------------- */

/** Tek bir gün bloğu — desen şeridinde ve takvim hücresinde aynı dil. */
export function DayBlock({
  type,
  size = 'md',
  title,
  className,
  children,
}: {
  type: string | null
  size?: 'xs' | 'sm' | 'md'
  title?: string
  className?: string
  children?: ReactNode
}) {
  const s = styleOf(type)
  const Icon = s.icon
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[5px] ring-1 ring-inset',
        size === 'xs' ? 'size-3.5' : size === 'sm' ? 'size-6' : 'size-8',
        s.block,
        className,
      )}
    >
      {children ?? (size !== 'xs' && <Icon aria-hidden className={size === 'sm' ? 'size-3.5' : 'size-4'} strokeWidth={1.75} />)}
    </span>
  )
}

/**
 * Desenin şerit görünümü. `startIndex` verilirse şerit o günden başlar
 * (ekibin "bugün" hangi günde olduğunu göstermek için).
 */
export function PatternStrip({
  days,
  size = 'sm',
  startIndex = 0,
  highlightIndex,
  className,
}: {
  days: ShiftPatternDay[]
  size?: 'xs' | 'sm' | 'md'
  startIndex?: number
  highlightIndex?: number
  className?: string
}) {
  const ordered = [...days].sort((a, b) => a.dayIndex - b.dayIndex)
  const rotated = ordered.map((_, i) => ordered[(i + startIndex) % ordered.length])
  return (
    <div
      role="img"
      aria-label={describeDays(ordered)}
      className={cn('flex flex-wrap items-center', size === 'xs' ? 'gap-0.5' : 'gap-1', className)}
    >
      {rotated.map((d, i) => (
        <DayBlock
          key={i}
          type={d.type}
          size={size}
          title={`${d.dayIndex + 1}. gün · ${DAY_STYLE[d.type].label}${d.startTime ? ` ${timeRange(d.startTime, d.endTime)}` : ''}`}
          className={cn(highlightIndex === d.dayIndex && 'ring-2 ring-foreground/70')}
        />
      ))}
    </div>
  )
}

/** Renk lejantı. */
export function Legend({ types, className }: { types: RosterDayType[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground', className)}>
      {types.map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <DayBlock type={t} size="xs" />
          {DAY_STYLE[t].label}
        </li>
      ))}
    </ul>
  )
}
