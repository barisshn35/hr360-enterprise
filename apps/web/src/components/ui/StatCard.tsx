/**
 * Genel bakış metrik kartı.
 *
 * Kaynak: 21st.dev "Stat Card" (felipemenezes098, id 26138) — sabit demo
 * içeriği prop'lara açıldı, trend rozetinin sabit emerald rengi tasarım
 * token'larına çevrildi (yoksa koyu temada rozet kopuk görünüyordu).
 *
 * İskelet varyantı 21st.dev "Stat Cards Skeleton" (id 18999) uyarlaması.
 */

import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CountUp } from '@/motion/primitives'
import { cn } from '@/lib/utils'

export type TrendDirection = 'up' | 'down' | 'flat'

/** Yükselişin iyi mi kötü mü olduğu metriğe göre değişir (izin bakiyesi vs. gecikmiş onay). */
export type TrendSense = 'positive' | 'negative' | 'neutral'

const TREND_ICON: Record<TrendDirection, React.ElementType> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
}

function toneClass(direction: TrendDirection, sense: TrendSense): string {
  if (sense === 'neutral' || direction === 'flat') return 'text-muted-foreground'
  const good = sense === 'positive' ? direction === 'up' : direction === 'down'
  return good ? 'text-[hsl(var(--success))]' : 'text-destructive'
}

export interface StatCardProps {
  label: string
  /** Hazır biçimlenmiş değer. Sayılabilir bir metrikse `count` tercih edin. */
  value?: string | number
  /**
   * Sayısal metrik: kart görününce 0'dan bu değere sayar. Ham sayı verilir,
   * biçimlendirme `format` ile — böylece ara kareler de tr-TR biçiminde olur.
   */
  count?: number
  format?: (value: number) => string
  icon?: React.ElementType
  /** Örn. "+%20,1" — biçimlendirme çağıran tarafta. */
  trend?: string
  trendDirection?: TrendDirection
  /** Yükseliş iyi mi? Varsayılan: iyi. */
  trendSense?: TrendSense
  /** Rozetin yanındaki açıklama, ör. "geçen aya göre". */
  compareLabel?: string
  className?: string
}

export function StatCard({
  label,
  value,
  count,
  format,
  icon: Icon,
  trend,
  trendDirection = 'flat',
  trendSense = 'positive',
  compareLabel,
  className,
}: StatCardProps) {
  const TrendIcon = TREND_ICON[trendDirection]

  return (
    <Card
      className={cn(
        'relative w-full transition-shadow duration-300 hover:shadow-md hover:shadow-foreground/5',
        className,
      )}
    >
      {Icon && (
        <div className="absolute top-6 right-6">
          <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
          </div>
        </div>
      )}
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="tabular text-2xl">
          {count !== undefined ? (
            <CountUp to={count} duration={1.1} format={format} />
          ) : (
            value
          )}
        </CardTitle>
      </CardHeader>
      {trend && (
        <CardDescription className="flex flex-wrap items-center gap-2 px-6">
          <Badge variant="secondary" className={cn('tabular', toneClass(trendDirection, trendSense))}>
            <TrendIcon className="size-3" />
            {trend}
          </Badge>
          {compareLabel}
        </CardDescription>
      )}
    </Card>
  )
}

/** Dashboard yüklenirken — önceki sürümdeki "boş ekran" şikayetinin karşılığı. */
export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-busy="true"
      className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="size-7 rounded-md" />
          </div>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}
