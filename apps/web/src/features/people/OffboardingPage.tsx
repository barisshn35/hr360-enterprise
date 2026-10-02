import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Calculator, Check, ClipboardCheck, LogOut, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { ProgressBar } from '@/components/ui/Progress'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, ErrorState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { engagementApi, offboardingReasonLabels, type ExitInterview, type OffboardingReason } from '@/api/engagement'
import { useAuth } from '@/auth/useAuth'
import { formatDate, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Initials, PersonSelect, PlanGate, isoDate, useAction } from '@/features/shared/kit'

function StartModal({ onClose }: { onClose: () => void }) {
  const [emp, setEmp] = useState('')
  const [day, setDay] = useState(isoDate(new Date(Date.now() + 14 * 86400000)))
  const [reason, setReason] = useState<OffboardingReason>('Resignation')
  const start = useAction(() => engagementApi.startOffboarding({ employeeId: emp, lastWorkingDay: day, reason }), { success: 'Ayrılış süreci başlatıldı', invalidate: [['offboarding']], onDone: onClose })
  return (
    <Modal open onClose={onClose} title="Ayrılış süreci başlat" note="Açık zimmetler kontrol listesine otomatik eklenir."
      footer={<><Button variant="outline" onClick={onClose}>Vazgeç</Button><Button disabled={!emp || start.isPending} onClick={() => start.mutate(undefined)}>Başlat</Button></>}>
      <div className="space-y-4">
        <PersonSelect label="Çalışan" value={emp} onChange={setEmp} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Son iş günü" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <SelectField label="Ayrılış nedeni" value={reason} onChange={(v) => setReason(v as OffboardingReason)} options={(Object.keys(offboardingReasonLabels) as OffboardingReason[]).map((k) => ({ value: k, label: offboardingReasonLabels[k] }))} />
        </div>
      </div>
    </Modal>
  )
}

function Settlement({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['offboarding', id, 'settlement'], queryFn: ({ signal }) => engagementApi.settlement(id, signal), retry: false })
  if (q.isPending) return <RowsSkeleton rows={2} />
  if (q.isError) return <p className="text-[13px] text-muted-foreground">Hak ediş hesabı için ücret görme yetkisi gerekir.</p>
  const s = q.data
  return (
    <div className="sensitive-scope space-y-3">
      {!s.hasSalary && <InfoNote>Bu çalışan için ücret kaydı yok; tutarlar 0 görünür. Ücret ekranından brüt ücret girin.</InfoNote>}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-3"><p className="text-[12px] text-muted-foreground">Kıdem tazminatı {s.severance.eligible ? '' : '(hak yok)'}</p><p className="tabular text-[18px] font-semibold">{formatMoney(s.severance.gross)}</p><p className="text-[11.5px] text-muted-foreground">net {formatMoney(s.severance.net)} · tavan {formatMoney(s.severanceCeiling)}</p></div>
        <div className="rounded-xl border border-border p-3"><p className="text-[12px] text-muted-foreground">İhbar ({s.notice.weeks} hafta) {s.notice.applies ? '' : '(uygulanmaz)'}</p><p className="tabular text-[18px] font-semibold">{formatMoney(s.notice.gross)}</p><p className="text-[11.5px] text-muted-foreground">brüt</p></div>
        <div className="rounded-xl border border-border p-3"><p className="text-[12px] text-muted-foreground">Kullanılmayan izin ({s.unusedLeave.days} gün)</p><p className="tabular text-[18px] font-semibold">{formatMoney(s.unusedLeave.gross)}</p><p className="text-[11.5px] text-muted-foreground">brüt</p></div>
      </div>
      <p className="text-[13px]">Kıdem: <b>{s.tenureYears} yıl</b> · Toplam brüt: <b>{formatMoney(s.totalGross)}</b></p>
      <details className="text-[12px] text-muted-foreground"><summary className="cursor-pointer">Yasal dayanaklar</summary><ul className="mt-1 list-disc space-y-1 pl-5"><li>{s.severance.basis}</li><li>{s.notice.basis}</li><li>{s.unusedLeave.basis}</li></ul></details>
      <p className="text-[11.5px] text-muted-foreground">{s.disclaimer}</p>
    </div>
  )
}

function CaseModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { roles } = useAuth()
  const q = useQuery({ queryKey: ['offboarding', id], queryFn: ({ signal }) => engagementApi.offboarding(id, signal) })
  const toggle = useAction(({ key, done }: { key: string; done: boolean }) => engagementApi.toggleChecklist(id, key, done), { invalidate: [['offboarding']] })
  const [iv, setIv] = useState<ExitInterview>({})
  const [rehire, setRehire] = useState<boolean | null>(null)
  const saveIv = useAction(() => engagementApi.saveExitInterview(id, iv, rehire), { success: 'Çıkış görüşmesi kaydedildi', invalidate: [['offboarding']] })
  const complete = useAction(() => engagementApi.completeOffboarding(id, true), { success: (r) => r.warning ?? 'Süreç tamamlandı; çalışan “Ayrıldı” durumuna alındı', invalidate: [['offboarding']], onDone: onClose })
  const c = q.data
  const showMoney = roles.some((r) => ['hr-admin', 'tenant-admin', 'platform-admin', 'ext-compensation-view'].includes(r))
  const Score = ({ k, label }: { k: keyof ExitInterview; label: string }) => (
    <div className="flex items-center justify-between gap-2 text-[13px]"><span>{label}</span><div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => (
      <button key={n} type="button" onClick={() => setIv({ ...iv, [k]: n })} className={cn('size-7 cursor-pointer rounded-md border text-[12px]', iv[k] === n ? 'border-primary bg-primary/15' : 'border-border')}>{n}</button>))}</div></div>
  )
  return (
    <Modal open onClose={onClose} size="xl" title={c ? `${c.employeeName} — ayrılış` : 'Ayrılış'} note={c ? `${offboardingReasonLabels[c.reason]} · son iş günü ${formatDate(c.lastWorkingDay)}` : undefined}
      footer={c?.status === 'Open' && <><Button variant="outline" onClick={onClose}>Kapat</Button><Button disabled={c.checklist.some((i) => !i.done) || complete.isPending} onClick={() => complete.mutate(undefined)}><LogOut className="size-4" /> Süreci tamamla</Button></>}>
      {!c ? <RowsSkeleton /> : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><ClipboardCheck className="size-4 text-primary" /> Kontrol listesi</p>
            <ul className="space-y-1.5">
              {c.checklist.map((it) => (
                <li key={it.key} className="flex items-start gap-2.5 rounded-xl border border-border p-2.5">
                  <Checkbox checked={it.done} disabled={c.status !== 'Open' || it.key === 'exit-interview'} onCheckedChange={(v) => toggle.mutate({ key: it.key, done: v === true })} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px]', it.done && 'text-muted-foreground line-through')}>{it.title}</p>
                    <p className="text-[11.5px] text-muted-foreground">{it.owner}{it.doneBy ? ` · ${it.doneBy}, ${formatDate(it.doneAt)}` : ''}{it.hint ? ` · ${it.hint}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-6">
            <div>
              <p className="mb-2 text-[14px] font-semibold">Çıkış görüşmesi</p>
              {c.exitInterview ? (
                <div className="space-y-1 rounded-xl bg-muted/40 p-3 text-[13px]">
                  <p>Ana neden: <b>{c.exitInterview.primaryReason ?? '—'}</b></p>
                  <p>Yönetici {c.exitInterview.managerScore ?? '—'}/5 · Kültür {c.exitInterview.cultureScore ?? '—'}/5 · Gelişim {c.exitInterview.growthScore ?? '—'}/5 · Ücret {c.exitInterview.compensationScore ?? '—'}/5</p>
                  <p>Tavsiye eder mi: {c.exitInterview.wouldRecommend == null ? '—' : c.exitInterview.wouldRecommend ? 'Evet' : 'Hayır'} · Yeniden işe alınabilir: {c.rehireEligible == null ? '—' : c.rehireEligible ? 'Evet' : 'Hayır'}</p>
                  {c.exitInterview.comments && <p className="text-muted-foreground">“{c.exitInterview.comments}”</p>}
                </div>
              ) : c.status === 'Open' ? (
                <div className="space-y-3">
                  <SelectField label="Ana ayrılış nedeni" value={iv.primaryReason ?? ''} onChange={(v) => setIv({ ...iv, primaryReason: v })} options={['Kariyer fırsatı', 'Ücret', 'Yönetici ilişkisi', 'İş yükü', 'Taşınma', 'Kişisel', 'Diğer'].map((x) => ({ value: x, label: x }))} />
                  <Score k="managerScore" label="Yöneticiyle ilişki" /><Score k="cultureScore" label="Şirket kültürü" /><Score k="growthScore" label="Gelişim fırsatı" /><Score k="compensationScore" label="Ücret ve yan haklar" />
                  <div className="flex gap-4 text-[13px]">
                    <label className="flex items-center gap-2"><Checkbox checked={iv.wouldRecommend === true} onCheckedChange={(v) => setIv({ ...iv, wouldRecommend: v === true })} /> Şirketi tavsiye eder</label>
                    <label className="flex items-center gap-2"><Checkbox checked={rehire === true} onCheckedChange={(v) => setRehire(v === true)} /> Yeniden işe alınabilir</label>
                  </div>
                  <TextAreaField label="Yorumlar" rows={2} value={iv.comments ?? ''} onChange={(e) => setIv({ ...iv, comments: e.target.value })} />
                  <Button size="sm" onClick={() => saveIv.mutate(undefined)} disabled={!iv.primaryReason}>Görüşmeyi kaydet</Button>
                </div>
              ) : <p className="text-[13px] text-muted-foreground">Görüşme yapılmadı.</p>}
            </div>
            {showMoney && (
              <div>
                <p className="mb-2 flex items-center gap-2 text-[14px] font-semibold"><Calculator className="size-4 text-primary" /> Tahmini hak ediş</p>
                <Settlement id={c.id} />
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

export function OffboardingPage() {
  const q = useQuery({ queryKey: ['offboarding'], queryFn: ({ signal }) => engagementApi.offboardings(signal) })
  const [starting, setStarting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <PlanGate feature="offboarding">
      <PageHeader title="İşten ayrılış" description="Zimmet iadesi, erişim kapatma, SGK bildirimi, çıkış görüşmesi ve hak ediş tahmini — eksiksiz ve izlenebilir bir veda." actions={<Button onClick={() => setStarting(true)}><Plus className="size-4" /> Süreç başlat</Button>} />
      {q.isPending ? <RowsSkeleton /> : q.isError ? <ErrorState message={(q.error as Error).message} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <EmptyState icon={LogOut} title="Açık ayrılış süreci yok" detail="Bir çalışan ayrılacağında süreci başlatın; kontrol listesi otomatik oluşur." action={<Button onClick={() => setStarting(true)}>Süreç başlat</Button>} />
      ) : (
        <Panel>
          <PanelHead title="Süreçler" />
          <PanelBody className="p-0">
            <ul className="divide-y divide-border">
              {q.data.map((c, i) => (
                <motion.li key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}>
                  <button className="flex w-full cursor-pointer flex-wrap items-center gap-4 px-5 py-3.5 text-left hover:bg-accent/30" onClick={() => setOpen(c.id)}>
                    <Initials name={c.employeeName} size={36} />
                    <div className="min-w-40 flex-1"><p className="text-[14px] font-medium">{c.employeeName}</p><p className="text-[12px] text-muted-foreground">{offboardingReasonLabels[c.reason]} · son gün {formatDate(c.lastWorkingDay)}</p></div>
                    <div className="w-48"><ProgressBar value={c.progress} tone={c.progress === 100 ? 'success' : 'info'} label={`${c.done}/${c.total} adım`} /></div>
                    {c.hasInterview && <StatusBadge tone="info"><Check className="size-3" /> görüşme</StatusBadge>}
                    <StatusBadge tone={c.status === 'Completed' ? 'success' : c.status === 'Open' ? 'warning' : 'neutral'}>{c.status === 'Completed' ? 'Tamamlandı' : c.status === 'Open' ? 'Açık' : 'İptal'}</StatusBadge>
                  </button>
                </motion.li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}
      {starting && <StartModal onClose={() => setStarting(false)} />}
      {open && <CaseModal id={open} onClose={() => setOpen(null)} />}
    </PlanGate>
  )
}
