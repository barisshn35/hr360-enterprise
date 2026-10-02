import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Check, FileDown, Receipt, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { BorderBeam } from '@/components/fx/border-beam'
import { useToast } from '@/components/ui/Toast'
import { governanceApi, type Invoice, type PlanName } from '@/api/governance'
import { formatDate, formatMoney } from '@/lib/format'
import { planLabels } from '@/lib/plan'
import { cn } from '@/lib/utils'
import { Metric, errMsg, useAction } from '@/features/shared/kit'

const FEATURE_TR: Record<string, string> = {
  kudos: 'Takdir duvarı', celebrations: 'Kutlamalar', profile: 'Self-servis profil', workplace: 'Ofis ve masa', surveys: 'Anket/eNPS', 'team-health': 'Ekip sağlığı',
  'payroll-sim': 'Bordro simülasyonu', calendar: 'Takvim aboneliği', mentorship: 'Mentorluk', mobility: 'İç ilanlar', 'one-on-ones': '1:1 görüşmeler', offboarding: 'Offboarding',
  privacy: 'KVKK araçları', documents: 'Belge şablonları', audit: 'Denetim kaydı', analytics: 'Analitik', assistant: 'İK asistanı', 'import-export': 'İçe/dışa aktarım',
  'ai-tools': 'Yapay zekâ araçları', succession: 'Ardıl planlama', 'org-scenarios': 'Org senaryoları', rules: 'Kural motoru', webhooks: 'Webhook', 'api-keys': 'Açık API',
  integrations: 'Slack/Teams', events: 'Canlı olay radarı', 'time-machine': 'Zaman makinesi', 'nl-report': 'Rapor asistanı', sso: 'SSO', sagas: 'İşe alım sagası',
}
const statusTone = { Issued: 'warning', Paid: 'success', Void: 'neutral' } as const
const statusLabel = { Issued: 'Ödeme bekliyor', Paid: 'Ödendi', Void: 'İptal' }

export function openInvoice(id: string, onError: (m: string) => void) {
  governanceApi.invoiceHtml(id).then((html) => {
    const w = window.open('', '_blank')
    if (!w) return onError('Açılır pencere engellendi.')
    w.document.write(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fatura</title></head><body style="padding:24px">${html}<script>setTimeout(()=>print(),300)<\/script></body></html>`)
    w.document.close()
  }).catch((e) => onError(errMsg(e)))
}

function InvoiceTable({ rows, platform }: { rows: Invoice[]; platform?: boolean }) {
  const toast = useToast()
  const [pay, setPay] = useState<Invoice | null>(null)
  const [ref, setRef] = useState('')
  const markPaid = useAction(() => governanceApi.payInvoice(pay!.id, ref), { success: 'Ödendi olarak işaretlendi', invalidate: [['billing']], onDone: () => setPay(null) })
  const voidIt = useAction((id: string) => governanceApi.voidInvoice(id), { success: 'Fatura iptal edildi', invalidate: [['billing']] })
  return (
    <>
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-border text-left text-[11.5px] text-muted-foreground">{[platform && 'Kiracı', 'No', 'Dönem', 'Plan', 'Koltuk', 'Toplam', 'Son ödeme', 'Durum', ''].filter(Boolean).map((h) => <th key={String(h)} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((i, n) => (
            <motion.tr key={i.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: n * 0.03 }} className="border-b border-border/50 last:border-0">
              {platform && <td className="px-4 py-2 font-medium">{i.tenantSlug}</td>}
              <td className="px-4 py-2 font-mono text-[12px]">{i.number}</td><td className="px-4">{i.period}</td><td className="px-4">{planLabels[i.plan]}</td>
              <td className="tabular px-4">{i.seats}</td><td className="tabular px-4 font-semibold">{formatMoney(i.total)}</td><td className="px-4">{formatDate(i.dueAt)}</td>
              <td className="px-4"><StatusBadge tone={statusTone[i.status]}>{statusLabel[i.status]}</StatusBadge></td>
              <td className="px-4 text-right">
                <div className="flex justify-end gap-1">
                  <Button size="xs" variant="outline" onClick={() => openInvoice(i.id, toast.stop)}><FileDown className="size-3" /> PDF</Button>
                  {platform && i.status === 'Issued' && <><Button size="xs" onClick={() => { setPay(i); setRef('') }}>Ödendi</Button><Button size="xs" variant="ghost" onClick={() => voidIt.mutate(i.id)}>İptal</Button></>}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
      {pay && (
        <Modal open onClose={() => setPay(null)} title={`${pay.number} — ödeme`} footer={<><Button variant="outline" onClick={() => setPay(null)}>Vazgeç</Button><Button onClick={() => markPaid.mutate(undefined)}>Kaydet</Button></>}>
          <TextField label="Dekont / işlem no" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Modal>
      )}
    </>
  )
}

export function BillingPage() {
  const b = useQuery({ queryKey: ['billing', 'me'], queryFn: ({ signal }) => governanceApi.billing(signal) })
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: ({ signal }) => governanceApi.billingPlans(signal), staleTime: Infinity })
  const d = b.data
  return (
    <>
      <PageHeader title="Abonelik" description="Planınız, faturalanan koltuk sayısı ve faturalar. Koltuk = aktif çalışan (en az 5)." />
      {b.isPending ? <RowsSkeleton /> : b.isError ? <EmptyState icon={Receipt} title="Abonelik bilgisi alınamadı" detail={errMsg(b.error)} /> : d && (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Plan" value={planLabels[d.plan]} />
            <Metric label="Faturalanan koltuk" value={d.billableSeats} hint={`${d.activeEmployees} aktif çalışan · kota ${d.maxEmployees}`} />
            <Metric label="Bu ay tahmini" value={formatMoney(d.estimate.total)} hint={`${formatMoney(d.pricePerSeat)} × ${d.billableSeats} + KDV`} />
            <Metric label="Ödenmemiş" value={formatMoney(d.outstanding)} tone={d.outstanding > 0 ? 'warn' : 'good'} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.data?.map((p, i) => {
              const current = p.plan === d.plan
              return (
                <motion.div key={p.plan} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className={cn('surface relative flex flex-col overflow-hidden rounded-3xl border p-6', current ? 'border-primary/60' : 'border-border')}>
                  {current && <BorderBeam size={180} duration={8} />}
                  <div className="flex items-center justify-between"><h3 className="text-[17px] font-semibold">{planLabels[p.plan as PlanName]}</h3>{current && <StatusBadge tone="info">Mevcut plan</StatusBadge>}</div>
                  <p className="mt-2"><span className="tabular text-[32px] font-semibold tracking-tight">{formatMoney(p.pricePerSeat)}</span><span className="text-[13px] text-muted-foreground"> / kişi / ay + KDV</span></p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-[13px]">
                    {p.features.map((f) => <li key={f} className="flex items-center gap-2"><Check className="size-3.5 text-primary" /> {FEATURE_TR[f] ?? f}</li>)}
                  </ul>
                  {!current && <p className="mt-4 text-[12px] text-muted-foreground">Plan değişikliği için platform yöneticisiyle iletişime geçin.</p>}
                </motion.div>
              )
            })}
          </div>
          <Panel>
            <PanelHead title="Faturalar" />
            <PanelBody className="overflow-x-auto p-0">{d.invoices.length === 0 ? <p className="p-5 text-[13px] text-muted-foreground">Henüz fatura kesilmedi (her ay başında otomatik).</p> : <InvoiceTable rows={d.invoices} />}</PanelBody>
          </Panel>
          <InfoNote><Sparkles className="mr-1 inline size-3.5" /> {d.paymentProvider ? `Ödemeler ${d.paymentProvider} üzerinden alınır.` : 'Kartla ödeme sağlayıcısı (iyzico/Stripe) henüz bağlı değil: faturalar havale/EFT ile ödenir ve platform yöneticisi tarafından “Ödendi” işaretlenir. Belgeler proforma niteliğindedir; resmî e-fatura muhasebeden kesilir.'}</InfoNote>
        </div>
      )}
    </>
  )
}

export function PlatformInvoicesPage() {
  const q = useQuery({ queryKey: ['billing', 'all'], queryFn: ({ signal }) => governanceApi.invoices(signal) })
  const [status, setStatus] = useState('all')
  const gen = useAction(() => governanceApi.generateInvoices(), { success: (r) => `${r.created} yeni fatura kesildi`, invalidate: [['billing']] })
  const rows = (q.data ?? []).filter((i) => status === 'all' || i.status === status)
  const sum = (s: Invoice['status']) => (q.data ?? []).filter((i) => i.status === s).reduce((a, i) => a + i.total, 0)
  return (
    <>
      <PageHeader title="Faturalar" description="Tüm kiracıların abonelik faturaları. Faturalar her ay başında otomatik kesilir." actions={<Button onClick={() => gen.mutate(undefined)} disabled={gen.isPending}>Bu ayın faturalarını kes</Button>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Metric label="Tahsil edilen" value={formatMoney(sum('Paid'))} tone="good" />
        <Metric label="Bekleyen" value={formatMoney(sum('Issued'))} tone="warn" />
        <Metric label="Fatura" value={q.data?.length ?? 0} />
      </div>
      <Panel>
        <PanelHead title="Liste" action={<div className="w-44"><SelectField label="" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Tümü' }, { value: 'Issued', label: 'Bekleyen' }, { value: 'Paid', label: 'Ödenen' }, { value: 'Void', label: 'İptal' }]} /></div>} />
        <PanelBody className="overflow-x-auto p-0">{q.isPending ? <div className="p-5"><RowsSkeleton /></div> : rows.length === 0 ? <p className="p-5 text-[13px] text-muted-foreground">Fatura yok.</p> : <InvoiceTable rows={rows} platform />}</PanelBody>
      </Panel>
    </>
  )
}
