import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Download, Globe2, Info, Printer, XCircle } from 'lucide-react'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/Confirm'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import {
  governanceApi, type AnalysisObjection, type ComplianceCheck, type TransferProviderInfo, type TransferStatus,
} from '@/api/governance'
import { downloadWorkbook } from '@/lib/spreadsheet'
import { formatDate, formatDateTime } from '@/lib/format'
import { PersonSelect, useAction } from '@/features/shared/kit'
import { accessLabel, objectionStatusLabel } from '@/features/profile/PrivacyExtras'
import { tx } from '@/lib/i18n'

/* ------------------------------------------------------------------ uyum durumu */

const checkIcon = { ok: CheckCircle2, warn: AlertTriangle, error: XCircle, info: Info } as const
const checkTone: Record<ComplianceCheck['status'], string> = {
  ok: 'text-[hsl(var(--success))]', warn: 'text-[hsl(var(--warning))]', error: 'text-destructive', info: 'text-muted-foreground',
}

export function ComplianceOverview({ onOpen }: { onOpen: (tab: string) => void }) {
  const q = useQuery({ queryKey: ['privacy', 'compliance'], queryFn: ({ signal }) => governanceApi.compliance(signal) })
  if (q.isPending) return <RowsSkeleton />
  return (
    <div className="space-y-4">
      <InfoNote>{tx('KVKK yükümlülüklerinin özeti. Sorunlu satıra tıklayarak ilgili sekmeye gidin. Bu ekran hukuki danışmanlığın yerini tutmaz.')}</InfoNote>
      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.map((c) => {
          const Icon = checkIcon[c.status]
          const body = (
            <>
              <Icon className={`mt-0.5 size-5 shrink-0 ${checkTone[c.status]}`} aria-hidden />
              <div className="min-w-0 text-left">
                <p className="text-[13.5px] font-medium">{c.title}</p>
                <p className="text-[12.5px] text-muted-foreground">{c.detail}</p>
              </div>
            </>
          )
          return c.tab ? (
            <button key={c.key} type="button" onClick={() => onOpen(c.tab!)} className="surface flex cursor-pointer gap-3 rounded-2xl border border-border p-4 hover:bg-muted/40">{body}</button>
          ) : (
            <div key={c.key} className="surface flex gap-3 rounded-2xl border border-border p-4">{body}</div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ envanter */

export function InventoryPanel() {
  const q = useQuery({ queryKey: ['privacy', 'inventory'], queryFn: ({ signal }) => governanceApi.inventory(signal) })
  if (q.isPending) return <RowsSkeleton />
  const rows = q.data!.activities
  const exportXlsx = () => downloadWorkbook('kisisel-veri-envanteri.xlsx', {
    [tx('Envanter')]: rows.map((a) => ({
      [tx('Modül')]: a.module, [tx('İşleme faaliyeti')]: a.activity, [tx('İlgili kişi grubu')]: a.subjects.join(', '),
      [tx('Veri kategorileri')]: a.dataCategories.join('; '), [tx('Amaç')]: a.purpose, [tx('Hukuki sebep')]: a.legalBasis,
      [tx('Özel nitelikli')]: a.special ? tx('Evet') : tx('Hayır'), [tx('Saklama süresi')]: a.retention
        + (a.retentionPolicy ? ` (${a.retentionPolicy.retentionMonths} ${tx('ay')}${a.retentionPolicy.isEnabled ? '' : ', ' + tx('otomatik değil')})` : ''),
      [tx('Alıcı grupları')]: a.recipients.join(', '),
      [tx('Yurt dışı aktarım')]: a.transfers.filter((t) => t.inUse).map((t) => t.name).join(', '),
      [tx('Güvenlik önlemleri')]: a.measures,
    })),
  })
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InfoNote>{tx('Kişisel veri işleme envanteri (KVKK m.16, VERBİS kaydına hazırlık). Yurt dışı aktarım sütunu şu an açık olan entegrasyonlara göre hesaplanır.')}</InfoNote>
        <Button variant="outline" onClick={() => void exportXlsx()}><Download className="size-4" />{' '}{tx('Excel olarak indir')}</Button>
      </div>
      <div className="space-y-3">
        {rows.map((a) => (
          <details key={a.id} className="surface rounded-2xl border border-border p-4">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium">{a.module} — {a.activity}</span>
              {a.special && <StatusBadge tone="warning">{tx('Özel nitelikli')}</StatusBadge>}
              {a.transfers.some((t) => t.inUse) && <StatusBadge tone="neutral">{tx('Yurt dışı aktarım')}</StatusBadge>}
              {a.retentionPolicy && !a.retentionPolicy.isEnabled && <StatusBadge tone="warning">{tx('İmha otomatik değil')}</StatusBadge>}
            </summary>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[12.5px] md:grid-cols-2">
              <div><dt className="text-muted-foreground">{tx('İlgili kişi grubu')}</dt><dd>{a.subjects.join(', ')}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Veri kategorileri')}</dt><dd>{a.dataCategories.join('; ')}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Amaç')}</dt><dd>{a.purpose}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Hukuki sebep')}</dt><dd>{a.legalBasis}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Saklama süresi')}</dt><dd>{a.retention}{a.retentionPolicy ? ` · ${a.retentionPolicy.retentionMonths} ${tx('ay')}` : ''}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Alıcı grupları')}</dt><dd>{a.recipients.length ? a.recipients.join(', ') : '—'}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Yurt dışı aktarım')}</dt><dd>{a.transfers.length ? a.transfers.map((t) => `${t.name}${t.inUse ? '' : ' (' + tx('kapalı') + ')'}`).join(', ') : '—'}</dd></div>
              <div><dt className="text-muted-foreground">{tx('Güvenlik önlemleri')}</dt><dd>{a.measures}</dd></div>
            </dl>
          </details>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ yurt dışı aktarım */

const transferTone: Record<TransferStatus, StatusTone> = { Missing: 'danger', NotifyOverdue: 'danger', NotifyPending: 'warning', Ok: 'success' }
function transferLabel(s: TransferStatus) {
  return s === 'Missing' ? tx('Dayanak yok') : s === 'NotifyOverdue' ? tx('Bildirim süresi geçti') : s === 'NotifyPending' ? tx('Kurul bildirimi bekliyor') : tx('Tamam')
}

function TransferEditor({ p, mechanisms, onClose }: { p: TransferProviderInfo; mechanisms: { value: string; label: string }[]; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [mechanism, setMechanism] = useState(p.agreement?.mechanism ?? 'StandardContract')
  const [signedAt, setSignedAt] = useState(p.agreement?.signedAt ?? today)
  const [notifiedAt, setNotifiedAt] = useState(p.agreement?.notifiedAt ?? '')
  const [reference, setReference] = useState(p.agreement?.reference ?? '')
  const [notes, setNotes] = useState(p.agreement?.notes ?? '')
  const save = useAction(() => governanceApi.saveTransfer(p.key, { mechanism, signedAt, notifiedAt: notifiedAt || null, reference, notes }),
    { success: tx('Aktarım dayanağı kaydedildi'), invalidate: [['privacy']], onDone: onClose })
  return (
    <Modal open onClose={onClose} title={p.name}
      note={tx('KVKK m.9: Yurt dışına aktarım için yeterlilik kararı, uygun güvence (standart sözleşme, bağlayıcı şirket kuralları, taahhütname) ya da istisnai hal gerekir. Standart sözleşme imzadan sonra 5 iş günü içinde Kurul\'a bildirilir.')}
      footer={<><Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button><Button onClick={() => save.mutate(undefined)} disabled={save.isPending || !signedAt}>{tx('Kaydet')}</Button></>}>
      <div className="space-y-4">
        <p className="rounded-xl bg-muted/50 p-3 text-[12.5px]">{tx('Aktarılan veri: {0}', [p.dataSent])} · {p.country}</p>
        <SelectField label={tx('Dayanak')} value={mechanism} onChange={setMechanism} options={mechanisms} />
        <TextField label={tx('İmza / karar tarihi')} type="date" max={today} value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
        {mechanism === 'StandardContract' && (
          <TextField label={tx('Kurul\'a bildirim tarihi')} type="date" max={today} value={notifiedAt} onChange={(e) => setNotifiedAt(e.target.value)}
            hint={tx('Henüz bildirilmediyse boş bırakın; süre dolmadan hatırlatılır.')} />
        )}
        <TextField label={tx('Referans (sözleşme no, KEP kaydı)')} value={reference} onChange={(e) => setReference(e.target.value)} />
        <TextAreaField label={tx('Not')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Modal>
  )
}

export function TransfersPanel() {
  const q = useQuery({ queryKey: ['privacy', 'transfers'], queryFn: ({ signal }) => governanceApi.transfers(signal) })
  const [edit, setEdit] = useState<TransferProviderInfo | null>(null)
  const remove = useAction((key: string) => governanceApi.deleteTransfer(key), { success: tx('Kayıt silindi'), invalidate: [['privacy']] })
  const confirm = useConfirm()
  if (q.isPending) return <RowsSkeleton />
  const d = q.data!
  return (
    <div className="space-y-4">
      <InfoNote>{tx('Bu hizmetler kişisel veriyi yurt dışına aktarır. Hukuki dayanak kaydedilmeden ilgili entegrasyon açılamaz ve veri gönderilmez. Yapay zekâ için yerel model (Ollama) kullanılırsa aktarım olmaz.')}</InfoNote>
      {d.llmLocal && <p className="text-[12.5px] text-muted-foreground">{tx('Yapay zekâ yerel modelle çalışıyor; yurt dışına aktarım yok.')}</p>}
      <Panel>
        <PanelBody className="p-0">
          <ul className="divide-y divide-border">
            {d.providers.map((p) => (
              <li key={p.key} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Globe2 className="size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">{p.name} {p.inUse && <span className="text-[11.5px] text-muted-foreground">· {tx('kullanımda')}</span>}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{p.usedBy} · {p.country}
                    {p.agreement ? ' · ' + tx('İmza {0}', [formatDate(p.agreement.signedAt)]) + (p.agreement.notifiedAt ? ' · ' + tx('Bildirim {0}', [formatDate(p.agreement.notifiedAt)]) : p.notifyDeadline ? ' · ' + tx('Son bildirim günü {0}', [formatDate(p.notifyDeadline)]) : '') : ''}</p>
                </div>
                <StatusBadge tone={p.status === 'Missing' && !p.inUse ? 'neutral' : transferTone[p.status]}>{transferLabel(p.status)}</StatusBadge>
                <Button size="sm" variant={p.agreement ? 'outline' : 'default'} onClick={() => setEdit(p)}>{p.agreement ? tx('Düzenle') : tx('Dayanak ekle')}</Button>
                {p.agreement && !p.inUse && <Button size="sm" variant="ghost" onClick={async () => {
                  if (await confirm({ title: tx('Aktarım dayanağı silinsin mi?'), note: tx('{0} için kayıtlı sözleşme/dayanak bilgisi silinir; bu hizmet yeniden açılmadan önce dayanak eklenmesi gerekir.', [p.name]), action: tx('Sil') })) remove.mutate(p.key)
                }}>{tx('Sil')}</Button>}
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
      {edit && <TransferEditor p={edit} mechanisms={d.mechanisms} onClose={() => setEdit(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ imha tutanakları */

export function DestructionLogsPanel() {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 6); return d.toISOString().slice(0, 10) })
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const q = useQuery({ queryKey: ['privacy', 'destruction', from, to], queryFn: ({ signal }) => governanceApi.destructionLogs({ from, to }, signal) })
  return (
    <Panel>
      <PanelHead title={tx('İmha tutanakları')}
        note={tx('Silme, yok etme ve anonimleştirme işlemlerinin kaydı. Yönetmelik gereği en az 3 yıl saklanır; periyodik imha en geç 6 ayda bir yapılmalıdır (otomatik politikalar günde bir çalışır).')}
        action={<Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="size-4" />{' '}{tx('Yazdır')}</Button>} />
      <PanelBody className="space-y-3">
        <div className="flex flex-wrap gap-3 print:hidden">
          <div className="w-44"><TextField label={tx('Başlangıç')} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="w-44"><TextField label={tx('Bitiş')} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {q.isPending ? <RowsSkeleton rows={3} /> : !q.data?.length ? <p className="text-[13px] text-muted-foreground">{tx('Bu aralıkta imha işlemi yok.')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">{tx('Tarih')}</th><th className="py-2 pr-3 font-medium">{tx('Veri kategorisi')}</th>
                <th className="py-2 pr-3 font-medium">{tx('Yöntem')}</th><th className="py-2 pr-3 font-medium">{tx('Kayıt')}</th>
                <th className="py-2 pr-3 font-medium">{tx('Tetikleyen')}</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {q.data.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.ranAt)}</td>
                    <td className="py-2 pr-3">{r.label}{r.retentionMonths ? ` (${r.retentionMonths} ${tx('ay')})` : ''}</td>
                    <td className="py-2 pr-3">{r.method}</td>
                    <td className="tabular py-2 pr-3">{r.affected}</td>
                    <td className="py-2 pr-3">{r.trigger === 'Periodic' ? tx('Periyodik') : r.trigger === 'Restore' ? tx('Geri yükleme sonrası') : r.trigger === 'Request' ? tx('Başvuru') : tx('Elle')} · {r.actor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelBody>
    </Panel>
  )
}

/* ------------------------------------------------------------------ erişim kayıtları */

export function AccessLogPanel() {
  const [emp, setEmp] = useState('')
  const [days, setDays] = useState('90')
  const q = useQuery({ queryKey: ['privacy', 'access-log', emp, days], queryFn: ({ signal }) => governanceApi.accessLog({ employeeId: emp || undefined, days: Number(days) }, signal) })
  return (
    <div className="space-y-4">
      <InfoNote>{tx('T.C. kimlik no, IBAN, ücret, özel profil bilgileri ve otomatik analizlere kimin eriştiği. Çalışanlar kendi kayıtlarını Profilim › Gizlilik ekranında görür.')}</InfoNote>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-72"><PersonSelect label={tx('Çalışan (boş = hepsi)')} value={emp} onChange={setEmp} /></div>
        <div className="w-40"><SelectField label={tx('Dönem')} value={days} onChange={setDays} options={[{ value: '30', label: tx('Son 30 gün') }, { value: '90', label: tx('Son 90 gün') }, { value: '365', label: tx('Son 1 yıl') }]} /></div>
      </div>
      {q.isPending ? <RowsSkeleton /> : !q.data?.length ? <EmptyState title={tx('Kayıt yok')} detail={tx('Bu dönemde hassas veriye erişim olmadı.')} /> : (
        <Panel>
          <PanelBody className="p-0">
            <ul className="divide-y divide-border">
              {q.data.map((r, i) => (
                <li key={i} className="px-5 py-2.5 text-[13px]">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><span className="font-medium">{r.viewer}</span> → {r.person ?? (r.employeeId === 'list' ? tx('toplu liste') : '—')}: {accessLabel(r)}</span>
                    <span className="text-[11.5px] text-muted-foreground">{formatDateTime(r.at)}</span>
                  </div>
                  {r.reason && <p className="text-[12px] text-muted-foreground">{tx('Gerekçe: {0}', [r.reason])}</p>}
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ itirazlar */

export function ObjectionsPanel() {
  const q = useQuery({ queryKey: ['privacy', 'objections'], queryFn: ({ signal }) => governanceApi.objections(signal) })
  const [sel, setSel] = useState<AnalysisObjection | null>(null)
  const [status, setStatus] = useState<'Upheld' | 'Rejected'>('Upheld')
  const [response, setResponse] = useState('')
  const decide = useAction(() => governanceApi.decideObjection(sel!.id, status, response), { success: tx('Karar kaydedildi; çalışana bildirildi.'), invalidate: [['privacy']], onDone: () => setSel(null) })
  if (q.isPending) return <RowsSkeleton />
  if (!q.data?.length) return <EmptyState title={tx('İtiraz yok')} detail={tx('Çalışanlar otomatik analizlere Profilim › Gizlilik ekranından itiraz eder.')} />
  return (
    <>
      <InfoNote>{tx('KVKK m.11/1-g. Açık ya da kabul edilmiş itirazda kişinin skoru üretilmez. Reddederken çalışana gerekçe yazın.')}</InfoNote>
      <Panel className="mt-4">
        <PanelBody className="p-0">
          <ul className="divide-y divide-border">
            {q.data.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><p className="text-[13.5px] font-medium">{o.personName} — {o.analysisLabel}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{o.reason ?? '—'} · {formatDate(o.createdAt)}{o.response ? ' · ' + tx('Yanıt: {0}', [o.response]) : ''}</p></div>
                <StatusBadge tone={o.status === 'Upheld' ? 'success' : o.status === 'Rejected' ? 'neutral' : o.overdue ? 'danger' : 'warning'}>{objectionStatusLabel(o)}</StatusBadge>
                {o.status === 'Open' && <Button size="sm" onClick={() => { setSel(o); setStatus('Upheld'); setResponse('') }}>{tx('Karar ver')}</Button>}
              </li>
            ))}
          </ul>
        </PanelBody>
      </Panel>
      {sel && (
        <Modal open onClose={() => setSel(null)} title={`${sel.personName} — ${sel.analysisLabel}`}
          footer={<><Button variant="outline" onClick={() => setSel(null)}>{tx('Vazgeç')}</Button><Button onClick={() => decide.mutate(undefined)} disabled={decide.isPending || !response.trim()}>{tx('Kaydet')}</Button></>}>
          <div className="space-y-4">
            <p className="rounded-xl bg-muted/50 p-3 text-[13px]">{sel.reason ?? tx('Gerekçe yazılmamış.')}</p>
            <SelectField label={tx('Karar')} value={status} onChange={(v) => setStatus(v as 'Upheld' | 'Rejected')}
              options={[{ value: 'Upheld', label: tx('Kabul (analiz bu kişi için yapılmaz)') }, { value: 'Rejected', label: tx('Ret (analiz yapılabilir)') }]} />
            <TextAreaField label={tx('Çalışana yanıt')} rows={4} value={response} onChange={(e) => setResponse(e.target.value)} />
          </div>
        </Modal>
      )}
    </>
  )
}
