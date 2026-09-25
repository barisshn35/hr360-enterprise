import { useSearchParams } from 'react-router-dom'
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
            'relative -mb-px flex min-h-11 shrink-0 cursor-pointer items-center gap-2 border-b-2 pb-2',
            'text-[14px] whitespace-nowrap transition-colors',
            value === tab.key
              ? 'border-primary font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="tabular text-[11px] text-muted-foreground">{tab.count}</span>
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
