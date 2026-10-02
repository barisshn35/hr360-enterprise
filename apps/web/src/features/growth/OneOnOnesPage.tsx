import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { CalendarPlus, Check, Lock, MessagesSquare, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, RowsSkeleton } from '@/components/ui/States'
import { engagementApi, type AgendaItem, type OneOnOne } from '@/api/engagement'
import { useAuth } from '@/auth/useAuth'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Initials, PlanGate, errMsg, useAction } from '@/features/shared/kit'
import { useToast } from '@/components/ui/Toast'
import { useMyEmployeeId } from '@/api/queries'
import { MeetingPanel, SlotFinder } from '@/features/shared/Meetings'

const MOODS = ['😞', '🙁', '😐', '🙂', '😄']

function Checklist({ title, items, onChange }: { title: string; items: AgendaItem[]; onChange: (next: AgendaItem[]) => void }) {
  const [draft, setDraft] = useState('')
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium">{title}</p>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {items.map((it, i) => (
            <motion.li key={it.id ?? i} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-accent/40">
              <button type="button" onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
                className={cn('grid size-5 shrink-0 cursor-pointer place-items-center rounded-md border transition', it.done ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {it.done && <Check className="size-3.5" />}
              </button>
              <span className={cn('flex-1 text-[13.5px]', it.done && 'text-muted-foreground line-through')}>{it.text}</span>
              {it.by && <span className="text-[11px] text-muted-foreground">{it.by.split(' ')[0]}</span>}
              <button type="button" aria-label="Sil" onClick={() => onChange(items.filter((_, j) => j !== i))} className="cursor-pointer text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive"><Trash2 className="size-3.5" /></button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onChange([...items, { text: draft.trim(), done: false }]); setDraft('') } }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Madde ekle…" className="h-9 flex-1 rounded-lg border border-input bg-background/60 px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30" />
        <Button type="submit" size="sm" variant="outline"><Plus className="size-4" /></Button>
      </form>
    </div>
  )
}

function MeetingDetail({ m }: { m: OneOnOne }) {
  const toast = useToast()
  const [shared, setShared] = useState(m.sharedNotes ?? '')
  const [priv, setPriv] = useState(m.privateNotes ?? '')
  useEffect(() => { setShared(m.sharedNotes ?? ''); setPriv(m.privateNotes ?? '') }, [m.id, m.sharedNotes, m.privateNotes])
  const upd = useAction((body: Parameters<typeof engagementApi.updateOneOnOne>[1]) => engagementApi.updateOneOnOne(m.id, body), { invalidate: [['one-on-ones']] })
  const del = useAction(() => engagementApi.deleteOneOnOne(m.id), { success: 'Silindi', invalidate: [['one-on-ones']] })
  const other = m.iAmManager ? m.employeeName : m.managerName
  return (
    <Panel>
      <PanelHead
        title={<span className="flex items-center gap-2.5"><Initials name={other} size={30} /> {other} ile 1:1</span>}
        note={formatDateTime(m.scheduledAt)}
        action={
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => engagementApi.oneOnOneIcs(m).catch((e) => toast.stop(errMsg(e)))}><CalendarPlus className="size-4" /> Takvime ekle</Button>
            {m.iAmManager && m.status === 'Planned' && <Button size="sm" onClick={() => upd.mutate({ status: 'Done' })}>Tamamlandı</Button>}
            {m.iAmManager && <Button size="icon" variant="ghost" aria-label="Sil" onClick={() => del.mutate(undefined)}><Trash2 className="size-4" /></Button>}
          </div>
        }
      />
      {m.status === 'Planned' && (
        <div className="border-b border-border px-5 py-3">
          <MeetingPanel sourceType="one-on-one" sourceId={m.id} canCreate={m.iAmManager} />
        </div>
      )}
      <PanelBody className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Checklist title="Ortak gündem" items={m.agenda} onChange={(agenda) => upd.mutate({ agenda })} />
          <Checklist title="Aksiyonlar" items={m.actionItems} onChange={(actionItems) => upd.mutate({ actionItems })} />
          {!m.iAmManager && (
            <div>
              <p className="mb-2 text-[13px] font-medium">Bu hafta nasılsın?</p>
              <div className="flex gap-2">{MOODS.map((f, i) => (
                <motion.button key={i} whileHover={{ scale: 1.15 }} whileTap={{ scale: 0.9 }} type="button" onClick={() => upd.mutate({ mood: i + 1 })} className={cn('grid size-11 cursor-pointer place-items-center rounded-xl border text-xl', m.mood === i + 1 ? 'border-primary bg-primary/15' : 'border-border opacity-60')}>{f}</motion.button>
              ))}</div>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <TextAreaField label="Ortak notlar (iki taraf da görür)" rows={6} value={shared} onChange={(e) => setShared(e.target.value)} onBlur={() => shared !== (m.sharedNotes ?? '') && upd.mutate({ sharedNotes: shared })} />
          {m.iAmManager && (
            <div>
              <TextAreaField label="Özel notlarım" rows={4} value={priv} onChange={(e) => setPriv(e.target.value)} onBlur={() => priv !== (m.privateNotes ?? '') && upd.mutate({ privateNotes: priv })} />
              <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted-foreground"><Lock className="size-3" /> Yalnızca siz görürsünüz; denetim kaydında içerik maskelenir.</p>
            </div>
          )}
          {m.mood != null && m.iAmManager && <p className="text-[13px] text-muted-foreground">Çalışanın ruh hâli: <span className="text-xl">{MOODS[m.mood - 1]}</span></p>}
        </div>
      </PanelBody>
    </Panel>
  )
}

function NewMeetingModal({ onClose, preset }: { onClose: () => void; preset?: string }) {
  const team = useQuery({ queryKey: ['one-on-ones', 'team'], queryFn: ({ signal }) => engagementApi.oneOnOneTeam(signal) })
  const [emp, setEmp] = useState(preset ?? '')
  const { employeeId: me } = useMyEmployeeId()
  const tomorrow = new Date(Date.now() + 86400000)
  const [when, setWhen] = useState(`${tomorrow.toISOString().slice(0, 10)}T10:00`)
  const [agenda, setAgenda] = useState('Geçen haftadan aksiyonlar\nEngeller ve destek ihtiyacı\nKariyer ve gelişim')
  const create = useAction(() => engagementApi.createOneOnOne({ employeeId: emp, scheduledAt: new Date(when).toISOString(), agenda: agenda.split('\n').filter((l) => l.trim()) }), {
    success: '1:1 planlandı; çalışana bildirim gitti', invalidate: [['one-on-ones']], onDone: onClose,
  })
  return (
    <Modal open onClose={onClose} title="1:1 planla" note="Önceki görüşmenin açık aksiyonları otomatik taşınır."
      footer={<><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button disabled={!emp || create.isPending} onClick={() => create.mutate(undefined)}>Planla</Button></>}>
      <div className="space-y-4">
        <SelectField label="Ekip üyesi" value={emp} onChange={setEmp} options={(team.data ?? []).map((t) => ({ value: t.employeeId, label: t.name }))} />
        <TextField label="Tarih ve saat" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        {emp && me && <SlotFinder employeeIds={[me, emp]} durationMinutes={30} onPick={setWhen} />}
        <TextAreaField label="Gündem (her satır bir madde)" rows={4} value={agenda} onChange={(e) => setAgenda(e.target.value)} />
      </div>
    </Modal>
  )
}

export function OneOnOnesPage() {
  const { can } = useAuth()
  const manager = can('performance:manage')
  const list = useQuery({ queryKey: ['one-on-ones', 'list'], queryFn: ({ signal }) => engagementApi.oneOnOnes(undefined, signal) })
  const team = useQuery({ queryKey: ['one-on-ones', 'team'], queryFn: ({ signal }) => engagementApi.oneOnOneTeam(signal), enabled: manager })
  const [sel, setSel] = useState<string | null>(null)
  const [newFor, setNewFor] = useState<string | undefined | null>(null)
  const selected = list.data?.find((m) => m.id === sel) ?? list.data?.find((m) => m.status === 'Planned') ?? list.data?.[0]

  return (
    <PlanGate feature="one-on-ones">
      <PageHeader title="1:1 görüşmeler" description="Yönetici ve çalışan için ortak gündem, aksiyon takibi ve özel notlar. Kimseyi unutmayın." actions={manager && <Button onClick={() => setNewFor(undefined)}><Plus className="size-4" /> 1:1 planla</Button>} />
      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <div className="space-y-5">
          {manager && (
            <Panel>
              <PanelHead title="Ekibim" note="En uzun süredir görüşmediklerin üstte." />
              <PanelBody className="space-y-1 p-2">
                {team.isPending ? <RowsSkeleton rows={3} /> : (team.data ?? []).length === 0 ? <p className="p-3 text-[13px] text-muted-foreground">Başı olduğunuz departman veya lideri olduğunuz ekip yok.</p> : team.data!.map((t) => (
                  <button key={t.employeeId} onClick={() => setNewFor(t.employeeId)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-accent/50">
                    <Initials name={t.name} size={30} />
                    <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{t.name}</p>
                      <p className="text-[11.5px] text-muted-foreground">{t.daysSinceLast == null ? 'Hiç görüşülmedi' : `${t.daysSinceLast} gün önce`}{t.openActions ? ` · ${t.openActions} açık aksiyon` : ''}</p></div>
                    {(t.daysSinceLast == null || t.daysSinceLast > 30) && <span className="size-2 rounded-full bg-[hsl(var(--warning))]" />}
                  </button>
                ))}
              </PanelBody>
            </Panel>
          )}
          <Panel>
            <PanelHead title="Görüşmeler" />
            <PanelBody className="space-y-1 p-2">
              {list.isPending ? <RowsSkeleton rows={3} /> : (list.data ?? []).length === 0 ? <p className="p-3 text-[13px] text-muted-foreground">Henüz görüşme yok.</p> : list.data!.map((m) => (
                <button key={m.id} onClick={() => setSel(m.id)} className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition', selected?.id === m.id ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-accent/50')}>
                  <Initials name={m.iAmManager ? m.employeeName : m.managerName} size={30} />
                  <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-medium">{m.iAmManager ? m.employeeName : m.managerName}</p><p className="text-[11.5px] text-muted-foreground">{formatDateTime(m.scheduledAt)}</p></div>
                  <StatusBadge tone={m.status === 'Planned' ? 'info' : m.status === 'Done' ? 'success' : 'neutral'}>{m.status === 'Planned' ? 'Planlı' : m.status === 'Done' ? 'Yapıldı' : 'İptal'}</StatusBadge>
                </button>
              ))}
            </PanelBody>
          </Panel>
        </div>
        <div>{selected ? <MeetingDetail m={selected} /> : <EmptyState icon={MessagesSquare} title="Görüşme seçin" detail={manager ? 'Ekibinizden biriyle 1:1 planlayarak başlayın.' : 'Yöneticiniz bir 1:1 planladığında burada görünür.'} />}</div>
      </div>
      {newFor !== null && <NewMeetingModal preset={newFor} onClose={() => setNewFor(null)} />}
    </PlanGate>
  )
}
