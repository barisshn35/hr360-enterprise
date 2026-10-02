import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Flame, HeartPulse, Info } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, ErrorState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { engagementApi, type TeamHealthMember } from '@/api/engagement'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Initials, Metric, PlanGate } from '@/features/shared/kit'

const riskTone = { High: 'danger', Medium: 'warning', Low: 'success' } as const
const riskLabel = { High: 'Dikkat', Medium: 'İzle', Low: 'İyi' }
const MOODS = ['😞', '🙁', '😐', '🙂', '😄']

function Bar({ value, max, danger }: { value: number; max: number; danger: number }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8 }} className={cn('h-full rounded-full', value >= danger ? 'bg-destructive' : value >= danger * 0.6 ? 'bg-[hsl(var(--warning))]' : 'bg-primary')} />
    </div>
  )
}

function MemberCard({ m, i }: { m: TeamHealthMember; i: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
      className={cn('surface rounded-2xl border p-4', m.risk === 'High' ? 'border-destructive/40' : m.risk === 'Medium' ? 'border-[hsl(var(--warning))]/30' : 'border-border')}>
      <div className="flex items-center gap-3">
        <Initials name={m.name} size={38} />
        <div className="min-w-0 flex-1"><p className="truncate text-[14px] font-semibold">{m.name}</p><p className="truncate text-[12px] text-muted-foreground">{m.position ?? '—'}</p></div>
        <StatusBadge tone={riskTone[m.risk]}>{riskLabel[m.risk]}</StatusBadge>
      </div>
      <div className="mt-4 space-y-2.5 text-[12.5px]">
        <div><div className="mb-1 flex justify-between"><span className="text-muted-foreground">Son izinden beri</span><span className="tabular">{m.daysSinceLeave} gün</span></div><Bar value={m.daysSinceLeave} max={180} danger={120} /></div>
        <div><div className="mb-1 flex justify-between"><span className="text-muted-foreground">Fazla mesai (30 gün)</span><span className="tabular">{m.overtimeHours30} sa</span></div><Bar value={m.overtimeHours30} max={40} danger={20} /></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Performans</span><span className="tabular">{m.latestScore ?? '—'}{m.scoreTrend ? <span className={m.scoreTrend < 0 ? 'text-destructive' : 'text-[hsl(var(--success))]'}> ({m.scoreTrend > 0 ? '+' : ''}{m.scoreTrend.toFixed(0)})</span> : null}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Takdir (90 gün)</span><span className="tabular">{m.kudos90}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">Son 1:1</span><span>{m.lastOneOnOne ? formatDate(m.lastOneOnOne) : '—'} {m.lastMood ? MOODS[m.lastMood - 1] : ''}</span></div>
      </div>
      {m.flags.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {m.flags.map((f) => <li key={f} className="flex items-start gap-1.5 text-[12px]"><Flame className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warning))]" /> {f}</li>)}
        </ul>
      )}
    </motion.div>
  )
}

export function TeamHealthPage() {
  const q = useQuery({ queryKey: ['team-health'], queryFn: ({ signal }) => engagementApi.teamHealth(undefined, signal) })
  const s = q.data?.summary
  return (
    <PlanGate feature="team-health">
      <PageHeader title="Ekip sağlığı" description="İzin, fazla mesai, performans, takdir ve 1:1 sinyallerini tek ekranda görün; kimin desteğe ihtiyacı olabileceğini erken fark edin." />
      <div className="mb-5"><InfoNote><Info className="mr-1 inline size-3.5" /> Bu bir teşhis değil, konuşma başlatıcıdır. Her bayrağın gerekçesi kartta yazılıdır; puanlama şeffaf kurallarla yapılır.</InfoNote></div>
      {q.isPending ? <RowsSkeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : q.data.members.length === 0 ? (
        <EmptyState icon={HeartPulse} title="Ekip bulunamadı" detail="Başı olduğunuz bir departman veya lideri olduğunuz bir ekip olduğunda üyeler burada görünür." />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Metric label="Ekip" value={s?.size ?? 0} />
            <Metric label="Dikkat" value={s?.atRisk ?? 0} tone={(s?.atRisk ?? 0) > 0 ? 'bad' : 'good'} />
            <Metric label="İzle" value={s?.watch ?? 0} tone={(s?.watch ?? 0) > 0 ? 'warn' : undefined} />
            <Metric label="Ort. fazla mesai" value={`${s?.avgOvertimeHours ?? 0} sa`} />
            <Metric label="Ort. izinsiz gün" value={s?.avgDaysSinceLeave ?? 0} />
            <Metric label="1:1 kapsamı" value={`%${s?.oneOnOneCoverage ?? 0}`} hint="son 45 gün" tone={(s?.oneOnOneCoverage ?? 0) >= 80 ? 'good' : 'warn'} />
          </div>
          <Panel>
            <PanelHead title="Ekip üyeleri" note="Önce en çok sinyali olanlar." />
            <PanelBody className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {q.data.members.map((m, i) => <MemberCard key={m.employeeId} m={m} i={i} />)}
            </PanelBody>
          </Panel>
        </>
      )}
    </PlanGate>
  )
}
