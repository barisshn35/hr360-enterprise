import { motion } from 'motion/react'
import { Ban, Flame, Target, TrendingUp } from 'lucide-react'
import { formatShareOf, goalStatusLabels, goalStatusTone, shareOf, type Goal } from '@/api/performance'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils'
import { EASE } from '@/motion/primitives'
import { formatGoalValue, progressOf } from './goalMath'

export function GoalCard({
  goal,
  totalWeight,
  index,
  canEdit,
  onUpdate,
}: {
  goal: Goal
  totalWeight: number
  index: number
  canEdit: boolean
  onUpdate: () => void
}) {
  const p = progressOf(goal)
  const share = goal.status === 'Cancelled' ? 0 : shareOf(goal.weight, totalWeight)
  const over = p.source === 'numeric' && (p.raw ?? 0) > 100
  const barColor =
    goal.status === 'Missed' ? 'hsl(var(--destructive))' : (p.pct ?? 0) >= 100 ? 'hsl(var(--success))' : (p.pct ?? 0) >= 60 ? 'hsl(var(--primary))' : 'hsl(var(--warning))'

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.5, ease: EASE, delay: Math.min(index, 8) * 0.06 }}
      className={cn('group rounded-xl border bg-card p-4 transition-shadow hover:shadow-md', goal.status === 'Cancelled' ? 'border-dashed border-border opacity-70' : 'border-border')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', p.source === 'numeric' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
            {goal.status === 'Cancelled' ? <Ban className="size-4" aria-hidden /> : p.source === 'numeric' ? <TrendingUp className="size-4" aria-hidden /> : <Target className="size-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <h3 className={cn('text-[14px] font-semibold', goal.status === 'Cancelled' && 'line-through decoration-muted-foreground/60')}>{goal.title}</h3>
            {goal.description && <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{goal.description}</p>}
          </div>
        </div>
        <StatusBadge tone={goalStatusTone[goal.status]}>{goalStatusLabels[goal.status]}</StatusBadge>
      </div>

      {p.pct !== null && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-muted-foreground">
              {p.source === 'numeric' ? (
                <>
                  <span className="tabular font-medium text-foreground">{formatGoalValue(goal.currentValue ?? 0, goal.unit)}</span> / {formatGoalValue(goal.targetValue, goal.unit)}
                </>
              ) : (
                'Sayısal hedef yok — ilerleme durumdan'
              )}
            </span>
            <span className="tabular text-[15px] font-semibold" style={{ color: barColor }}>
              %{Math.round(p.pct)}
            </span>
          </div>
          <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full"
              style={{ background: barColor }}
              initial={{ width: 0 }}
              animate={{ width: `${p.pct}%` }}
              transition={{ duration: 1, ease: EASE, delay: 0.15 + index * 0.05 }}
            />
            {over && <span aria-hidden className="hr-sheen absolute inset-0" />}
          </div>
          {over && (
            <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-[hsl(var(--success))]/10 px-1.5 py-0.5 text-[11px] font-medium text-[hsl(var(--success))]">
              <Flame className="size-3" aria-hidden />
              Hedef aşıldı: %{Math.round(p.raw ?? 0)} gerçekleşti — puana %100 olarak yansır.
            </p>
          )}
          {p.source === 'status' && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {goalStatusLabels[goal.status]} = %{Math.round(p.pct)} sayılır (Gerçekleşti %100 · Devam ediyor %50 · Gerçekleşmedi %0).
            </p>
          )}
        </div>
      )}
      {goal.status === 'Cancelled' && <p className="mt-3 text-[12px] text-muted-foreground">İptal edilen hedef hedef ayağının hesabına girmez.</p>}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-[12px] text-muted-foreground">
          Ağırlık <span className="tabular font-semibold text-foreground">{goal.weight}</span>
          {goal.status !== 'Cancelled' && (
            <>
              {' '}· hedeflerin <span className="tabular font-semibold text-foreground">{formatShareOf(share)}</span>
            </>
          )}
        </p>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={onUpdate}>
            İlerlemeyi güncelle
          </Button>
        )}
      </div>
    </motion.article>
  )
}
