import type { ReactNode } from 'react'

/** Her modül sayfasının üst bandı: başlık, kısa açıklama ve birincil eylem. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-[20px] leading-tight font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
