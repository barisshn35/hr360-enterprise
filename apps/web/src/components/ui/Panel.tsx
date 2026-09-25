import type { HTMLAttributes, ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/**
 * Sınırlanmış içerik bölgesi. shadcn `Card`'ının üzerine başlık/not/eylem
 * bandı ve gövde ekler — 20 ekranda aynı üç parça tekrar tekrar kurulmasın.
 */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Card className={cn('gap-0 overflow-hidden py-0', className)} {...props} />
}

export function PanelHead({
  title,
  note,
  action,
  className,
}: {
  title: ReactNode
  note?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-b border-border px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-[13px] text-muted-foreground">{note}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

export function PanelBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />
}

/**
 * Etiketli veri satırı (tanım listesi öğesi). Etiket sakin, değer okunur;
 * hiyerarşi büyük harfle değil renk ve boyutla kurulur.
 */
export function DataField({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px]">{children}</dd>
    </div>
  )
}
