import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Durum rozeti. On dört modülün her birinde farklı enum var ama görsel dil
 * tek: beş ton. Modüller kendi enum'unu tona eşler, renk kararı burada kalır.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE: Record<StatusTone, string> = {
  neutral: 'bg-muted text-muted-foreground border-transparent',
  success:
    'bg-[hsl(var(--success))]/12 text-[hsl(var(--success))] border-[hsl(var(--success))]/25',
  warning:
    'bg-[hsl(var(--warning))]/12 text-[hsl(var(--warning))] border-[hsl(var(--warning))]/25',
  danger: 'bg-destructive/10 text-destructive border-destructive/25',
  info: 'bg-primary/10 text-primary border-primary/25',
}

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusTone
  children: React.ReactNode
  className?: string
}) {
  return (
    <Badge variant="outline" className={cn('font-medium', TONE[tone], className)}>
      {children}
    </Badge>
  )
}
