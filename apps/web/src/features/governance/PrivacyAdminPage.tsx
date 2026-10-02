import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Download, EraserIcon, Play, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { dataRequestLabels, governanceApi, type DataRequest, type RetentionPolicy } from '@/api/governance'
import { formatDate, formatDateTime } from '@/lib/format'
import { PersonSelect, PlanGate, errMsg, useAction } from '@/features/shared/kit'

function Consents() {
  const q = useQuery({ queryKey: ['privacy', 'consents', 'all'], queryFn: ({ signal }) => governanceApi.consentSummary(signal) })
  if (q.isPending) return <RowsSkeleton />
  const d = q.data!
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {d.types.map((t, i) => {
          const total = Math.max(1, d.population)
          return (
            <motion.div key={t.type} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="surface rounded-2xl border border-border p-4">
              <p className="text-[13.5px] font-medium">{t.title}</p>
              <p className="text-[11.5px] text-muted-foreground">sürüm {t.version}{t.required ? ' · bilgilendirme (zorunlu)' : ' · açık rıza'}</p>
              <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted">
                <motion.div initial={{ width: 0 }} animate={{ width: `${(100 * t.granted) / total}%` }} className="bg-[hsl(var(--success))]" />
                <motion.div initial={{ width: 0 }} animate={{ width: `${(100 * t.denied) / total}%` }} className="bg-destructive" />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">{t.granted} onay · {t.denied} ret · {t.pending} bekliyor</p>
            </motion.div>
          )
        })}
      </div>
      <Panel>
        <PanelHead title="Aydınlatma metnini okumamış çalışanlar" note="Bu kişilere hatırlatma gönderin; giriş yaptıklarında Profilim → Gizlilik sekmesinden onaylayabilirler." />
        <PanelBody className="p-0">
          {d.missingRequired.length === 0 ? <p className="p-5 text-[13px] text-muted-foreground">Herkes okudu. 🎉</p> : (
            <ul className="divide-y divide-border">{d.missingRequired.map((m) => <li key={m.employeeId} className="flex justify-between px-5 py-2.5 text-[13px]"><span>{m.name}</span><span className="text-muted-foreground">{m.department ?? '—'}</span></li>)}</ul>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}

function Requests() {
  const q = useQuery({ queryKey: ['privacy', 'requests'], queryFn: ({ signal }) => governanceApi.dataRequests(signal) })
  const [sel, setSel] = useState<DataRequest | null>(null)
  const [status, setStatus] = useState<DataRequest['status']>('InProgress')
  const [response, setResponse] = useState('')
  const toast = useToast()
  const upd = useAction(() => governanceApi.updateDataRequest(sel!.id, status, response), { success: 'Başvuru güncellendi', invalidate: [['privacy']], onDone: () => setSel(null) })
  if (q.isPending) return <RowsSkeleton />
  if (!q.data?.length) return <EmptyState icon={ShieldCheck} title="Başvuru yok" detail="Çalışanlar KVKK m.11 başvurularını Profilim → Gizlilik ekranından yapar." />
  return (
    <>
      <Panel>
        <PanelBody className="p-0">
          <ul className="divide-y divide-border">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><p className="text-[13.5px] font-medium">{r.personName} — {dataRequestLabels[r.kind]}</p><p className="truncate text-[12px] text-muted-foreground">{r.details ?? '—'} · {formatDate(r.createdAt)}</p></div>
                <StatusBadge tone={r.status === 'Completed' ? 'success' : r.status === 'Rejected' ? 'neutral' : r.overdue ? 'danger' : 'warning'}>
                  {r.status === 'Completed' ? 'Yanıtlandı' : r.status === 'Rejected' ? 'Reddedildi' : r.overdue ? 'Süre aşıldı' : `${r.daysLeft} gün kaldı`}
                </StatusBadge>
                {r.employeeId && <Button size="sm" variant="outline" onClick={() => governanceApi.exportPersonalData(r.employeeId!).catch((e) => toast.stop(errMsg(e)))}><Download className="size-4" /> Veri dökümü</Button>}
                {(r.status === 'Received' || r.status === 'InProgress') && <Button size="sm" onClick={() => { setSel(r); setStatus('Completed'); setResponse('') }}>Yanıtla</Button>}
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
      {sel && (
        <Modal open onClose={() => setSel(null)} title={`${sel.personName} — ${dataRequestLabels[sel.kind]}`} note="KVKK m.13: başvuru en geç 30 gün içinde ücretsiz sonuçlandırılır; red gerekçeli olmalıdır."
          footer={<><Button variant="outline" onClick={() => setSel(null)}>Vazgeç</Button><Button onClick={() => upd.mutate(undefined)} disabled={upd.isPending}>Kaydet</Button></>}>
          <div className="space-y-4">
            <p className="rounded-xl bg-muted/50 p-3 text-[13px]">{sel.details ?? 'Açıklama yok.'}</p>
            <SelectField label="Durum" value={status} onChange={(v) => setStatus(v as DataRequest['status'])} options={[{ value: 'InProgress', label: 'İnceleniyor' }, { value: 'Completed', label: 'Sonuçlandı' }, { value: 'Rejected', label: 'Reddedildi' }]} />
            <TextAreaField label="Başvurucuya yanıt" rows={4} value={response} onChange={(e) => setResponse(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  )
}

function RetentionRow({ p }: { p: RetentionPolicy }) {
  const [months, setMonths] = useState(String(p.retentionMonths))
  const [action, setAction] = useState(p.action)
  const [enabled, setEnabled] = useState(p.isEnabled)
  const save = useAction(() => governanceApi.updateRetention(p.id, { retentionMonths: Number(months), action, isEnabled: enabled }), { success: 'Politika kaydedildi', invalidate: [['privacy', 'retention']] })
  const run = useAction(() => governanceApi.runRetention(p.id), { success: (r) => `${r.affected} kayıt işlendi`, invalidate: [['privacy', 'retention']] })
  return (
    <div className="grid items-end gap-3 rounded-2xl border border-border p-4 md:grid-cols-[1.6fr_110px_150px_auto_auto]">
      <div><p className="text-[13.5px] font-medium">{p.label}</p><p className="text-[11.5px] text-muted-foreground">Son çalışma: {p.lastRunAt ? `${formatDateTime(p.lastRunAt)} · ${p.lastAffected} kayıt` : 'hiç'}</p></div>
      <TextField label="Süre (ay)" type="number" min={1} max={240} value={months} onChange={(e) => setMonths(e.target.value)} />
      <SelectField label="İşlem" value={action} onChange={setAction} options={p.allowedActions.map((a) => ({ value: a, label: a === 'Anonymize' ? 'Anonimleştir' : 'Sil' }))} />
      <label className="flex h-9 items-center gap-2 text-[13px]"><Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} /> Otomatik</label>
      <div className="flex gap-2"><Button size="sm" onClick={() => save.mutate(undefined)}>Kaydet</Button><Button size="sm" variant="outline" onClick={() => run.mutate(undefined)} title="Şimdi çalıştır"><Play className="size-4" /></Button></div>
    </div>
  )
}

function Retention() {
  const q = useQuery({ queryKey: ['privacy', 'retention'], queryFn: ({ signal }) => governanceApi.retention(signal) })
  const [emp, setEmp] = useState('')
  const anon = useAction(() => governanceApi.anonymize(emp), { success: 'Çalışan anonimleştirildi', onDone: () => setEmp('') })
  return (
    <div className="space-y-5">
      <InfoNote>KVKK m.7 gereği işleme amacı ortadan kalkan veriler silinir veya anonimleştirilir. Otomatik politikalar günde bir kez çalışır; “▶” ile hemen çalıştırabilirsiniz. Bordro/SGK kayıtları için yasal saklama süreleri (ör. 10 yıl) gözetilmelidir.</InfoNote>
      {q.isPending ? <RowsSkeleton /> : q.data?.map((p) => <RetentionRow key={p.id} p={p} />)}
      <Panel>
        <PanelHead title={<span className="flex items-center gap-2"><EraserIcon className="size-4 text-destructive" /> Tek çalışanı anonimleştir</span>} note="Yalnızca işten ayrılmış çalışanlar. Geri alınamaz: ad, e-posta, telefon, adres, IBAN, TCKN silinir; istatistik alanları kalır." />
        <PanelBody className="flex flex-wrap items-end gap-3">
          <div className="w-72"><PersonSelect label="Çalışan" value={emp} onChange={setEmp} /></div>
          <Button variant="destructive" disabled={!emp || anon.isPending} onClick={() => anon.mutate(undefined)}>Anonimleştir</Button>
        </PanelBody>
      </Panel>
    </div>
  )
}

export function PrivacyAdminPage() {
  const [tab, setTab] = useTabParam<'riza' | 'basvuru' | 'saklama'>('sekme', 'riza')
  return (
    <PlanGate feature="privacy">
      <PageHeader title="KVKK" description="Aydınlatma ve açık rıza kayıtları, ilgili kişi başvuruları (30 gün kuralı), kişisel veri dökümü, saklama süresi ve anonimleştirme." />
      <div className="mb-5"><Tabs label="KVKK" value={tab} onChange={setTab} tabs={[{ key: 'riza', label: 'Rıza durumu' }, { key: 'basvuru', label: 'Başvurular' }, { key: 'saklama', label: 'Saklama & imha' }]} /></div>
      {tab === 'riza' && <Consents />}
      {tab === 'basvuru' && <Requests />}
      {tab === 'saklama' && <Retention />}
    </PlanGate>
  )
}
