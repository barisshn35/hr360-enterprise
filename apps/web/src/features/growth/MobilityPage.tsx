import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Briefcase, Megaphone, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField } from '@/components/ui/Field'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { DataTable } from '@/components/ui/DataTable'
import { EmptyState, ErrorState, RowsSkeleton } from '@/components/ui/States'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { engagementApi, internalAppLabels, type InternalAppStatus, type InternalApplication, type InternalPosting } from '@/api/engagement'
import { useAuth } from '@/auth/useAuth'
import { formatDate } from '@/lib/format'
import { PlanGate, useAction } from '@/features/shared/kit'

const tone: Record<InternalAppStatus, StatusTone> = { Submitted: 'info', Reviewing: 'warning', Interview: 'warning', Accepted: 'success', Rejected: 'danger', Withdrawn: 'neutral' }

export function MobilityPage() {
  const { can } = useAuth()
  const manager = can('recruitment:view')
  const [tab, setTab] = useTabParam<'ilanlar' | 'basvurular'>('sekme', 'ilanlar')
  const postings = useQuery({ queryKey: ['mobility', 'postings'], queryFn: ({ signal }) => engagementApi.internalPostings(signal) })
  const apps = useQuery({ queryKey: ['mobility', 'apps'], queryFn: ({ signal }) => engagementApi.internalApplications(signal) })
  const [applying, setApplying] = useState<InternalPosting | null>(null)
  const [motivation, setMotivation] = useState('')
  const apply = useAction(() => engagementApi.applyInternal({ jobPostingId: applying!.id, motivation }), { success: 'Başvurunuz İK’ya iletildi', invalidate: [['mobility']], onDone: () => setApplying(null) })
  const setStatus = useAction(({ id, s }: { id: string; s: InternalAppStatus }) => engagementApi.setInternalStatus(id, s), { success: 'Durum güncellendi', invalidate: [['mobility']] })

  return (
    <PlanGate feature="mobility">
      <PageHeader title="İç ilanlar" description="Şirket içindeki açık pozisyonlar önce size açılıyor. Kariyerinizin bir sonraki adımı belki yan masada." />
      <div className="mb-5"><Tabs label="İç ilan" value={tab} onChange={setTab} tabs={[{ key: 'ilanlar', label: 'Açık pozisyonlar', count: postings.data?.length }, { key: 'basvurular', label: manager ? 'İç başvurular' : 'Başvurularım', count: apps.data?.length }]} /></div>
      {tab === 'ilanlar' ? (
        postings.isPending ? <RowsSkeleton /> : postings.isError ? <ErrorState message={(postings.error as Error).message} /> : postings.data.length === 0 ? (
          <EmptyState icon={Megaphone} title="Şu an açık pozisyon yok" detail="İşe alım ekibi yeni bir ilan yayınladığında burada görünür." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {postings.data.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -4 }} className="surface flex flex-col rounded-2xl border border-border p-5">
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground"><Briefcase className="size-3.5" /> {p.department ?? 'Genel'} · {p.employmentType === 'FullTime' ? 'Tam zamanlı' : p.employmentType ?? ''}</div>
                <h3 className="mt-2 text-[16px] font-semibold">{p.title}</h3>
                <p className="mt-1.5 line-clamp-3 flex-1 text-[13px] text-muted-foreground">{p.description || 'Açıklama girilmemiş.'}</p>
                <div className="mt-3 flex items-center gap-3 text-[12px] text-muted-foreground">
                  <span>{p.headcount} kişilik kadro</span>
                  <span className="flex items-center gap-1"><Users className="size-3.5" /> {p.internalApplicants} iç başvuru</span>
                  {p.publishedAt && <span>{formatDate(p.publishedAt)}</span>}
                </div>
                {p.myApplication && p.myApplication.status !== 'Withdrawn' ? (
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-[13px]">Başvurdunuz <StatusBadge tone={tone[p.myApplication.status]}>{internalAppLabels[p.myApplication.status]}</StatusBadge></div>
                ) : (
                  <Button className="mt-4" onClick={() => { setApplying(p); setMotivation('') }}>İç başvuru yap</Button>
                )}
              </motion.div>
            ))}
          </div>
        )
      ) : (
        <DataTable<InternalApplication>
          rows={apps.data}
          isLoading={apps.isPending}
          error={apps.error}
          rowKey={(r) => r.id}
          emptyTitle="Başvuru yok"
          exportFileName="ic-basvurular"
          columns={[
            { id: 'p', header: 'Çalışan', cell: (r) => <div><p className="font-medium">{r.personName}</p><p className="text-[12px] text-muted-foreground">{r.currentPosition ?? '—'} · {r.currentDepartment ?? '—'}</p></div>, searchText: (r) => r.personName },
            { id: 'j', header: 'Pozisyon', cell: (r) => r.jobTitle, searchText: (r) => r.jobTitle },
            { id: 'm', header: 'Motivasyon', cell: (r) => <span className="line-clamp-2 text-[12.5px] text-muted-foreground">{r.motivation ?? '—'}</span>, hideBelow: 'md' },
            { id: 'd', header: 'Tarih', cell: (r) => formatDate(r.createdAt), sortValue: (r) => r.createdAt, hideBelow: 'sm' },
            {
              id: 's', header: 'Durum', cell: (r) => manager && !r.mine ? (
                <div className="w-36"><SelectField label="" value={r.status} onChange={(v) => setStatus.mutate({ id: r.id, s: v as InternalAppStatus })} options={(Object.keys(internalAppLabels) as InternalAppStatus[]).filter((s) => s !== 'Withdrawn').map((s) => ({ value: s, label: internalAppLabels[s] }))} /></div>
              ) : (
                <div className="flex items-center gap-2"><StatusBadge tone={tone[r.status]}>{internalAppLabels[r.status]}</StatusBadge>
                  {r.mine && !['Withdrawn', 'Accepted', 'Rejected'].includes(r.status) && <Button size="xs" variant="outline" onClick={() => setStatus.mutate({ id: r.id, s: 'Withdrawn' })}>Geri çek</Button>}</div>
              ),
            },
          ]}
        />
      )}
      {applying && (
        <Modal open onClose={() => setApplying(null)} title={`İç başvuru — ${applying.title}`} note="Başvurunuz İK ve işe alım ekibine gider. Mevcut yöneticinizle konuşmanızı öneririz."
          footer={<><Button variant="outline" onClick={() => setApplying(null)}>Vazgeç</Button><Button onClick={() => apply.mutate(undefined)} disabled={apply.isPending}>Başvur</Button></>}>
          <TextAreaField label="Neden bu rol?" rows={4} maxLength={2000} value={motivation} onChange={(e) => setMotivation(e.target.value)} placeholder="Deneyiminiz ve bu rolde ne katmak istediğiniz" />
        </Modal>
      )}
    </PlanGate>
  )
}
