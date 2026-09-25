const dateFmt = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

const dateTimeFmt = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const numberFmt = new Intl.NumberFormat('tr-TR')

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatDate(value: string | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? dateFmt.format(d) : fallback
}

export function formatDateTime(value: string | null | undefined, fallback = '—'): string {
  const d = toDate(value)
  return d ? dateTimeFmt.format(d) : fallback
}

export function formatNumber(value: number | null | undefined, fallback = '—'): string {
  return typeof value === 'number' && Number.isFinite(value) ? numberFmt.format(value) : fallback
}

export function formatPercent(value: number, digits = 0): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** "3 gün gecikti" / "5 saat kaldı" gibi göreli ifade. */
export function formatRelativeToNow(value: string | null | undefined): string {
  const d = toDate(value)
  if (!d) return '—'
  const diffMs = d.getTime() - Date.now()
  const rtf = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' })
  const abs = Math.abs(diffMs)
  const hour = 3_600_000
  const day = 24 * hour

  if (abs < hour) return rtf.format(Math.round(diffMs / 60_000), 'minute')
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour')
  return rtf.format(Math.round(diffMs / day), 'day')
}

export function initialsOf(firstName?: string, lastName?: string): string {
  const a = firstName?.trim()?.[0] ?? ''
  const b = lastName?.trim()?.[0] ?? ''
  return (a + b).toLocaleUpperCase('tr-TR') || '?'
}

export function fullName(p: { firstName?: string; lastName?: string }): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || 'İsimsiz kayıt'
}

/** Türkçe karakter duyarlı arama normalizasyonu. */
export function normalizeSearch(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim()
}

/** Para birimi biçimi. Kuruş yalnızca tam sayı olmayan tutarlarda gösterilir. */
export function formatMoney(
  value: number | null | undefined,
  currency = 'TRY',
  fallback = '—',
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}
