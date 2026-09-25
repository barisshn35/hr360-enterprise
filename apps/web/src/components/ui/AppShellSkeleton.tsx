/**
 * İlk açılış iskeleti — oturum doğrulanırken tam sayfa.
 *
 * Kaynak: 21st.dev "Sidebar Dashboard Skeleton" (cnippet-dev, id 19009).
 * Demo sabit 320px'lik bir kutuydu; HR360'ın gerçek kabuğuna ölçeklendi
 * (260px sidebar, 56px üst bant) ki içerik gelince sayfa yerinden oynamasın.
 * Bileşenin kendi shimmer keyframe'i `index.css`'e yazılmak istiyordu;
 * token dosyasına dokunmamak için standart `Skeleton` kullanıldı.
 */

import { Skeleton } from '@/components/ui/skeleton'

export function AppShellSkeleton({ label = 'Yükleniyor' }: { label?: string }) {
  return (
    <div aria-busy="true" className="flex min-h-dvh bg-background">
      <span className="sr-only">{label}</span>

      <div className="hidden w-[260px] shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3 lg:flex">
        <div className="mb-4 flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-8 rounded-md" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-14" />
          </div>
        </div>

        {[68, 52, 60, 44, 56, 48].map((width, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px]">
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}

        <div className="mt-auto space-y-1 border-t border-sidebar-border pt-4">
          {[50, 62].map((width, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-md px-2.5 py-[7px]">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-5">
          <Skeleton className="h-5 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        </div>

        <div className="flex-1 space-y-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="space-y-2">
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-3.5 w-72" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-3 rounded-lg border border-border p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-7 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-lg border border-border p-4">
            <Skeleton className="h-8 w-full max-w-xs rounded-md" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-1">
                <Skeleton className="h-4 w-[28%]" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
