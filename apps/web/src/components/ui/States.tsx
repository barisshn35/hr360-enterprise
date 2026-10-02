import type { ReactNode } from 'react'
import { Inbox, LoaderCircle, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './button'
import { Skeleton } from './skeleton'

/**
 * Her listenin üç hâli tek yerden gelir: yükleniyor / boş / hata.
 * Ekranlar bunları kendi başına kurgulamaz — aksi hâlde 20 ekranda 20 farklı
 * boş durum metni oluşuyor.
 */

export function CenteredSpinner({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-40 items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
    >
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin text-primary" />
      {label}
    </div>
  )
}

/** Tam sayfa (oturum doğrulanırken) — sayfa yerinden oynamasın diye ortalanır. */
export function FullPageSpinner({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background"
    >
      <span className="relative flex size-12 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
        <span className="relative flex size-10 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/25">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-primary" />
        </span>
      </span>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  )
}

/** Tablo iskeleti: sütun sayısı verilen düzeni korur, içerik gelince zıplamaz. */
export function RowsSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="divide-y divide-border">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-4 rounded-sm', c === 0 ? 'w-[28%]' : c === columns - 1 ? 'w-20' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Boş ekran bir davettir: ne olduğunu söyler ve bir sonraki adımı verir.
 *
 * Görsel: 21st.dev "Empty State" (serafimcloud, id 1435) — kesik çizgili
 * çerçeve ve üzerine gelince yelpaze gibi açılan ikon kartları. HR360
 * uyarlaması: tek ikon da üçlü yelpaze olarak çizilir (yan kartlar sönük),
 * ikonlar zümrüt tonda, çerçeve panelin içinde taşmadan durur.
 */
export function EmptyState({
  title,
  detail,
  action,
  icon: Icon = Inbox,
  icons,
  className,
}: {
  title: string
  detail?: string
  action?: ReactNode
  icon?: React.ElementType
  /** Yelpazedeki üç ikon (ortadaki ana ikon). Verilmezse `icon` kullanılır. */
  icons?: [React.ElementType, React.ElementType, React.ElementType]
  className?: string
}) {
  const [Left, Center, Right] = icons ?? [null, Icon, null]
  const tile =
    'grid size-11 place-items-center rounded-xl bg-card shadow-lg ring-1 ring-border transition duration-500 group-hover:duration-200'
  return (
    <div className={cn('px-4 py-10', className)}>
      <div className="group mx-auto flex max-w-md flex-col items-center rounded-2xl border border-dashed border-border bg-dot-grid px-6 py-10 text-center transition-colors duration-500 hover:border-primary/30 hover:duration-200">
        <div className="isolate flex justify-center">
          <div
            className={cn(
              tile,
              'relative top-1.5 left-2.5 -rotate-6 opacity-70 group-hover:-translate-x-4 group-hover:-translate-y-0.5 group-hover:-rotate-12',
            )}
          >
            {Left ? (
              <Left aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.5} />
            ) : (
              <span className="h-1.5 w-5 rounded-full bg-muted" />
            )}
          </div>
          <div className={cn(tile, 'relative z-10 group-hover:-translate-y-1')}>
            <Center aria-hidden="true" className="size-5 text-primary" strokeWidth={1.5} />
          </div>
          <div
            className={cn(
              tile,
              'relative top-1.5 right-2.5 rotate-6 opacity-70 group-hover:translate-x-4 group-hover:-translate-y-0.5 group-hover:rotate-12',
            )}
          >
            {Right ? (
              <Right aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.5} />
            ) : (
              <span className="h-1.5 w-5 rounded-full bg-muted" />
            )}
          </div>
        </div>
        <p className="mt-6 text-[15px] font-semibold">{title}</p>
        {detail && (
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{detail}</p>
        )}
        {action && <div className="mt-5">{action}</div>}
      </div>
    </div>
  )
}

/** Hata ne olduğunu ve nasıl düzeltileceğini söyler; özür dilemez. */
export function ErrorState({
  title = 'Veriler alınamadı',
  message,
  onRetry,
}: {
  title?: string
  message?: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="px-4 py-14">
      <div className="mx-auto flex max-w-md gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4 shadow-[inset_0_1px_0_0_hsl(var(--edge-light))]">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">{title}</p>
          {message && (
            <p className="mt-1 text-[13px] leading-relaxed break-words text-muted-foreground">
              {message}
            </p>
          )}
          {onRetry && (
            <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
              Yeniden dene
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Sayfa başlığı altındaki kısa bilgi şeridi (ör. Kafka otomasyonu notu). */
export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}
