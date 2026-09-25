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
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </div>
  )
}

/** Tam sayfa (oturum doğrulanırken) — sayfa yerinden oynamasın diye ortalanır. */
export function FullPageSpinner({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div
      aria-busy="true"
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background"
    >
      <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
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

/** Boş ekran bir davettir: ne olduğunu söyler ve bir sonraki adımı verir. */
export function EmptyState({
  title,
  detail,
  action,
  icon: Icon = Inbox,
}: {
  title: string
  detail?: string
  action?: ReactNode
  icon?: React.ElementType
}) {
  return (
    <div className="px-4 py-14">
      <div className="mx-auto flex max-w-sm flex-col items-center text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.5} />
        </span>
        <p className="text-[15px] font-semibold">{title}</p>
        {detail && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
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
      <div className="mx-auto flex max-w-md gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
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
    <p className="rounded-lg border border-border bg-muted/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}
