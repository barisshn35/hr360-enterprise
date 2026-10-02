import { useId } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'

export interface TabDef<T extends string> {
  key: T
  label: string
  /** Sağda küçük bir sayı gösterir (ör. bekleyen adet). */
  count?: number
}

/**
 * Alt çizgili sekme şeridi.
 *
 * Seçim URL'de tutulur (bkz. useTabParam), böylece derin bağlantı ve geri
 * tuşu doğru çalışır; varsayılan sekme adrese yazılmaz, adres temiz kalır.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: Array<TabDef<T>>
  value: T
  onChange: (next: T) => void
  label: string
}) {
  // Etkin sekmenin alt çizgisi sekmeler arasında kayar (21st.dev "animated
  // tabs" deseni); aynı sayfada iki şerit olabileceği için kimlik benzersiz.
  const indicatorId = useId()
  const reduced = useReducedMotion()
  return (
    <div
      role="tablist"
      aria-label={label}
      className="no-scrollbar flex gap-6 overflow-x-auto border-b border-border"
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          role="tab"
          type="button"
          aria-selected={value === tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'relative flex min-h-11 shrink-0 cursor-pointer items-center gap-2 pb-2',
            'text-[13.5px] whitespace-nowrap transition-colors',
            value === tab.key
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span
              className={cn(
                'tabular rounded-full px-1.5 py-px text-[10.5px] font-medium',
                value === tab.key ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
              )}
            >
              {tab.count}
            </span>
          )}
          {value === tab.key && (
            <motion.span
              aria-hidden="true"
              layoutId={reduced ? undefined : `tab-${indicatorId}`}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.7)]"
            />
          )}
        </button>
      ))}
    </div>
  )
}

/**
 * Sekme durumunu URL'de tutan yardımcı.
 * `defaultKey` adrese yazılmaz — varsayılan görünümün adresi sade kalır.
 */
export function useTabParam<T extends string>(param: string, defaultKey: T) {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = (searchParams.get(param) as T | null) ?? defaultKey

  const setValue = (next: T) => {
    const params = new URLSearchParams(searchParams)
    if (next === defaultKey) params.delete(param)
    else params.set(param, next)
    setSearchParams(params, { replace: true })
  }

  return [value, setValue] as const
}
