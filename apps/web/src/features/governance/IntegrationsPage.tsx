import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { Copy, KeyRound, MessageSquare, Plus, RefreshCw, Send, Trash2, Webhook as WebhookIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { governanceApi, type Webhook } from '@/api/governance'
import { formatDateTime, formatRelativeToNow } from '@/lib/format'
import { PlanGate, useAction } from '@/features/shared/kit'
import { ChatAppsPanel } from './ChatAppsPanel'
import { CalendarProvidersPanel } from './CalendarProvidersPanel'

const EVENTS = ['*', 'employee.hired', 'employee.assigned', 'employee.status-changed', 'workflow.submitted', 'workflow.approved', 'workflow.rejected', 'leave.approved']

function EventPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">Olaylar</p>
      <div className="flex flex-wrap gap-1.5">
        {EVENTS.map((e) => {
          const on = value.includes(e)
          return <button key={e} type="button" onClick={() => onChange(on ? value.filter((x) => x !== e) : [...value, e])} className={`cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11.5px] transition ${on ? 'border-primary bg-primary/15' : 'border-border text-muted-foreground'}`}>{e === '*' ? 'tümü (*)' : e}</button>
        })}
      </div>
    </div>
  )
}

function Copyable({ text, mono = true }: { text: string; mono?: boolean }) {
  const toast = useToast()
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1">
      <span className={`truncate ${mono ? 'font-mono text-[11.5px]' : 'text-[12.5px]'}`}>{text}</span>
      <button onClick={() => navigator.clipboard.writeText(text).then(() => toast.ok('Kopyalandı'))} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Kopyala"><Copy className="size-3.5" /></button>
    </span>
  )
}

function Webhooks() {
  const list = useQuery({ queryKey: ['webhooks'], queryFn: ({ signal }) => governanceApi.webhooks(signal) })
  const [form, setForm] = useState<{ name: string; url: string; events: string[] } | null>(null)
  const [inbox, setInbox] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Webhook | null>(null)
  const create = useAction(() => governanceApi.createWebhook({ ...form!, isEnabled: true }), { success: 'Webhook eklendi', invalidate: [['webhooks']], onDone: () => setForm(null) })
  const test = useAction(() => governanceApi.createTestReceiver(), { success: 'Test alıcısı oluşturuldu', invalidate: [['webhooks']], onDone: (r) => setInbox(r.token) })
  const ping = useAction((id: string) => governanceApi.pingWebhook(id), { success: (r) => (r.ok ? `Teslim edildi (HTTP ${r.lastStatus})` : `Başarısız (HTTP ${r.lastStatus ?? '—'})`), invalidate: [['webhooks']] })
  const rotate = useAction((id: string) => governanceApi.rotateWebhookSecret(id), { success: 'Yeni gizli anahtar üretildi', invalidate: [['webhooks']] })
  const del = useAction((id: string) => governanceApi.deleteWebhook(id), { success: 'Silindi', invalidate: [['webhooks']] })
  const inboxQ = useQuery({ queryKey: ['webhook-inbox', inbox], enabled: !!inbox, queryFn: ({ signal }) => governanceApi.webhookInbox(inbox!, signal), refetchInterval: 3000 })
  const dQ = useQuery({ queryKey: ['webhook-deliveries', deliveries?.id], enabled: !!deliveries, queryFn: ({ signal }) => governanceApi.webhookDeliveries(deliveries!.id, signal) })
  return (
    <div className="space-y-5">
      <InfoNote>Her teslimat <code className="font-mono text-[12px]">X-HR360-Signature: sha256=…</code> başlığıyla HMAC-SHA256 imzalanır (gövde + gizli anahtar). Alıcı imzayı doğrulamalıdır. 20 ardışık hatada webhook otomatik kapanır.</InfoNote>
      <div className="flex gap-2"><Button onClick={() => setForm({ name: '', url: 'https://', events: ['*'] })}><Plus className="size-4" /> Webhook</Button><Button variant="outline" onClick={() => test.mutate(undefined)}><WebhookIcon className="size-4" /> Test alıcısı oluştur</Button></div>
      {list.isPending ? <RowsSkeleton /> : (list.data ?? []).length === 0 ? <EmptyState icon={WebhookIcon} title="Webhook yok" detail="Bir sistem HR360 olaylarını anında almak istiyorsa buraya adresini ekleyin." /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data!.map((w) => (
            <div key={w.id} className="surface rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="text-[14px] font-semibold">{w.name}</p><Copyable text={w.url} /></div>
                <StatusBadge tone={!w.isEnabled ? 'neutral' : w.lastStatus == null ? 'info' : w.lastStatus < 300 ? 'success' : 'danger'}>{!w.isEnabled ? 'Kapalı' : w.lastStatus == null ? 'Bekliyor' : `HTTP ${w.lastStatus}`}</StatusBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">{w.events.map((e) => <span key={e} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px]">{e}</span>)}</div>
              <div className="mt-2 text-[12px] text-muted-foreground">Gizli anahtar: <Copyable text={w.secret} /></div>
              <p className="mt-1 text-[11.5px] text-muted-foreground">{w.lastDeliveredAt ? `Son teslim ${formatRelativeToNow(w.lastDeliveredAt)}` : 'Henüz teslim yok'}{w.failureCount ? ` · ${w.failureCount} ardışık hata` : ''}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => ping.mutate(w.id)}><Send className="size-4" /> Ping</Button>
                <Button size="sm" variant="outline" onClick={() => setDeliveries(w)}>Teslimatlar</Button>
                {w.url.includes('/inbox/') && <Button size="sm" variant="outline" onClick={() => setInbox(w.url.split('/inbox/')[1])}>Gelen kutusu</Button>}
                <Button size="sm" variant="ghost" onClick={() => rotate.mutate(w.id)} title="Anahtarı yenile"><RefreshCw className="size-4" /></Button>
                <Button size="sm" variant="ghost" onClick={() => del.mutate(w.id)} aria-label="Sil"><Trash2 className="size-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal open onClose={() => setForm(null)} title="Yeni webhook" footer={<><Button variant="outline" onClick={() => setForm(null)}>Vazgeç</Button><Button disabled={!form.name || !form.url.startsWith('http') || !form.events.length} onClick={() => create.mutate(undefined)}>Ekle</Button></>}>
          <div className="space-y-4"><TextField label="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><TextField label="Adres (https)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /><EventPicker value={form.events} onChange={(v) => setForm({ ...form, events: v })} /></div>
        </Modal>
      )}
      {inbox && (
        <Modal open onClose={() => setInbox(null)} size="lg" title="Test alıcısı — gelen kutusu" note="3 sn'de bir yenilenir. Bir izin talebi oluşturun veya Ping gönderin.">
          <ul className="space-y-2">
            {(inboxQ.data ?? []).length === 0 && <p className="text-[13px] text-muted-foreground">Henüz teslimat yok.</p>}
            {inboxQ.data?.map((d, i) => (
              <motion.li key={d.receivedAt + i} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border p-3">
                <div className="mb-1 flex items-center gap-2 text-[12px]"><span className="font-mono">{d.event ?? '—'}</span><StatusBadge tone={d.signatureValid ? 'success' : d.signatureValid === false ? 'danger' : 'neutral'}>{d.signatureValid ? 'imza geçerli' : d.signatureValid === false ? 'imza GEÇERSİZ' : 'imzasız'}</StatusBadge><span className="text-muted-foreground">{formatDateTime(d.receivedAt)}</span></div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap">{(() => { try { return JSON.stringify(JSON.parse(d.body), null, 2) } catch { return d.body } })()}</pre>
              </motion.li>
            ))}
          </ul>
        </Modal>
      )}
      {deliveries && (
        <Modal open onClose={() => setDeliveries(null)} size="lg" title={`Teslimatlar — ${deliveries.name}`}>
          <ul className="divide-y divide-border text-[12.5px]">
            {dQ.data?.map((d) => <li key={d.id} className="flex items-center gap-3 py-2"><span className="tabular w-36 text-muted-foreground">{formatDateTime(d.occurredAt)}</span><span className="font-mono">{d.eventType}</span><StatusBadge tone={d.statusCode && d.statusCode < 300 ? 'success' : 'danger'}>{d.statusCode ?? 'hata'}</StatusBadge><span className="text-muted-foreground">{d.durationMs} ms</span>{d.error && <span className="truncate text-destructive">{d.error}</span>}</li>)}
          </ul>
        </Modal>
      )}
    </div>
  )
}

function ApiKeys() {
  const list = useQuery({ queryKey: ['api-keys'], queryFn: ({ signal }) => governanceApi.apiKeys(signal) })
  const scopes = useQuery({ queryKey: ['api-scopes'], queryFn: ({ signal }) => governanceApi.apiScopes(signal), staleTime: Infinity })
  const [form, setForm] = useState<{ name: string; scopes: string[] } | null>(null)
  const [created, setCreated] = useState<string | null>(null)
  const create = useAction(() => governanceApi.createApiKey(form!.name, form!.scopes), { invalidate: [['api-keys']], onDone: (r) => { setForm(null); setCreated(r.key) } })
  const revoke = useAction((id: string) => governanceApi.revokeApiKey(id), { success: 'Anahtar iptal edildi', invalidate: [['api-keys']] })
  const base = `${window.location.origin}/api/governance/public/v1`
  return (
    <div className="space-y-5">
      <div className="flex gap-2"><Button onClick={() => setForm({ name: '', scopes: ['employees:read'] })}><KeyRound className="size-4" /> Yeni anahtar</Button></div>
      <Panel>
        <PanelBody className="p-0">
          {list.isPending ? <div className="p-5"><RowsSkeleton /></div> : (list.data ?? []).length === 0 ? <p className="p-5 text-[13px] text-muted-foreground">Anahtar yok.</p> : (
            <ul className="divide-y divide-border">{list.data!.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]">
                <KeyRound className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1"><p className="font-medium">{k.name}</p><p className="font-mono text-[11.5px] text-muted-foreground">hr360_{k.prefix}_•••• · {k.scopes.join(', ')}</p></div>
                <span className="text-[12px] text-muted-foreground">{k.lastUsedAt ? `son kullanım ${formatRelativeToNow(k.lastUsedAt)}` : 'hiç kullanılmadı'}</span>
                {k.active ? <Button size="sm" variant="outline" onClick={() => revoke.mutate(k.id)}>İptal et</Button> : <StatusBadge>İptal</StatusBadge>}
              </li>
            ))}</ul>
          )}
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHead title="Açık API v1" note="Salt okunur · dakikada 120 istek · OpenAPI tanımı aşağıda" />
        <PanelBody className="space-y-2 text-[12.5px]">
          {['employees', 'departments', 'leaves?from=2026-01-01', 'events?since=2026-10-01T00:00:00Z'].map((p) => <pre key={p} className="overflow-x-auto rounded-lg bg-muted/50 p-2.5 font-mono text-[11.5px]">curl -H "X-Api-Key: hr360_…" {base}/{p}</pre>)}
          <p>OpenAPI: <Copyable text={`${base}/openapi.json`} /></p>
        </PanelBody>
      </Panel>
      {form && (
        <Modal open onClose={() => setForm(null)} title="Yeni API anahtarı" footer={<><Button variant="outline" onClick={() => setForm(null)}>Vazgeç</Button><Button disabled={!form.name || !form.scopes.length} onClick={() => create.mutate(undefined)}>Oluştur</Button></>}>
          <div className="space-y-4"><TextField label="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Örn. Power BI" />
            <div className="space-y-2">{scopes.data?.map((s) => <label key={s} className="flex items-center gap-2 font-mono text-[12.5px]"><Checkbox checked={form.scopes.includes(s)} onCheckedChange={(v) => setForm({ ...form, scopes: v === true ? [...form.scopes, s] : form.scopes.filter((x) => x !== s) })} /> {s}</label>)}</div></div>
        </Modal>
      )}
      {created && (
        <Modal open onClose={() => setCreated(null)} title="Anahtarınız hazır" note="Bu anahtar yalnızca şimdi gösterilir; güvenli bir yere kaydedin. Kaybederseniz iptal edip yenisini oluşturun.">
          <Copyable text={created} />
        </Modal>
      )}
    </div>
  )
}

function ChatIntegrations() {
  const list = useQuery({ queryKey: ['integrations'], queryFn: ({ signal }) => governanceApi.integrations(signal) })
  const [form, setForm] = useState<{ kind: string; name: string; webhookUrl: string; events: string[]; signingSecret: string } | null>(null)
  const create = useAction(() => governanceApi.createIntegration({ ...form!, signingSecret: form!.signingSecret || null, isEnabled: true }), { success: 'Kanal bağlandı', invalidate: [['integrations']], onDone: () => setForm(null) })
  const test = useAction((id: string) => governanceApi.testIntegration(id), { success: (r) => (r.ok ? 'Test mesajı gönderildi' : `Gönderilemedi (HTTP ${r.lastStatus ?? '—'})`), invalidate: [['integrations']] })
  const del = useAction((id: string) => governanceApi.deleteIntegration(id), { success: 'Kaldırıldı', invalidate: [['integrations']] })
  return (
    <div className="space-y-5">
      <InfoNote>Bir kanala olay duyurusu (ör. “yeni çalışan katıldı”) göndermek için. Slack: “Incoming Webhooks” ile kanal adresi alın. Teams: kanalda <b>Workflows › “Post to a channel when a webhook request is received”</b> şablonuyla akış oluşturup adresini girin (eski “Gelen Web Kancası” bağlayıcıları Microsoft tarafından kapatıldı). Kişiye özel bildirim ve onay düğmeleri için “Sohbet uygulamaları” sekmesini kullanın.</InfoNote>
      <Button onClick={() => setForm({ kind: 'Slack', name: '#ik-duyurular', webhookUrl: 'https://hooks.slack.com/services/…', events: ['employee.hired', 'leave.approved'], signingSecret: '' })}><Plus className="size-4" /> Kanal bağla</Button>
      {list.isPending ? <RowsSkeleton /> : (list.data ?? []).length === 0 ? <EmptyState icon={MessageSquare} title="Bağlı kanal yok" /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.data!.map((i) => (
            <div key={i.id} className="surface rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between"><p className="text-[14px] font-semibold">{i.kind} · {i.name}</p><StatusBadge tone={i.lastStatus == null ? 'info' : i.lastStatus < 300 ? 'success' : 'danger'}>{i.lastStatus == null ? 'Denenmedi' : `HTTP ${i.lastStatus}`}</StatusBadge></div>
              <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">{i.webhookUrl}</p>
              <div className="mt-2 flex flex-wrap gap-1">{i.events.map((e) => <span key={e} className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10.5px]">{e}</span>)}</div>
              {i.kind === 'Slack' && <div className="mt-2 text-[12px] text-muted-foreground">Komut adresi: <Copyable text={`${window.location.origin}/api/governance/integrations/${i.id}/slack-command`} /></div>}
              <div className="mt-3 flex gap-1.5"><Button size="sm" variant="outline" onClick={() => test.mutate(i.id)}><Send className="size-4" /> Test</Button><Button size="sm" variant="ghost" onClick={() => del.mutate(i.id)}><Trash2 className="size-4" /></Button></div>
            </div>
          ))}
        </div>
      )}
      {form && (
        <Modal open onClose={() => setForm(null)} title="Kanal bağla" footer={<><Button variant="outline" onClick={() => setForm(null)}>Vazgeç</Button><Button disabled={!form.webhookUrl.startsWith('http')} onClick={() => create.mutate(undefined)}>Bağla</Button></>}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3"><SelectField label="Platform" value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} options={[{ value: 'Slack', label: 'Slack' }, { value: 'Teams', label: 'Microsoft Teams' }]} /><TextField label="Ad" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <TextField label="Gelen webhook adresi" value={form.webhookUrl} onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })} />
            {form.kind === 'Slack' && <TextField label="Slack Signing Secret (isteğe bağlı, slash komutu için)" value={form.signingSecret} onChange={(e) => setForm({ ...form, signingSecret: e.target.value })} />}
            <EventPicker value={form.events} onChange={(v) => setForm({ ...form, events: v })} />
          </div>
        </Modal>
      )}
    </div>
  )
}

export function IntegrationsPage() {
  const [tab, setTab] = useTabParam<'webhook' | 'api' | 'uygulama' | 'sohbet' | 'takvim'>('sekme', 'uygulama')
  return (
    <PlanGate feature="webhooks">
      <PageHeader title="Entegrasyonlar" description="Slack ve Microsoft Teams'ten onay, Google ve Microsoft 365 takvimleri, Zoom/Teams/Meet toplantıları, kanal bildirimleri, webhook'lar ve açık API." />
      <div className="mb-5"><Tabs label="Entegrasyon" value={tab} onChange={setTab} tabs={[{ key: 'uygulama', label: 'Sohbet uygulamaları' }, { key: 'takvim', label: 'Takvim ve toplantı' }, { key: 'sohbet', label: 'Kanal bildirimleri' }, { key: 'webhook', label: 'Webhook' }, { key: 'api', label: 'API anahtarları' }]} /></div>
      {tab === 'webhook' && <Webhooks />}
      {tab === 'api' && <ApiKeys />}
      {tab === 'uygulama' && <ChatAppsPanel />}
      {tab === 'takvim' && <CalendarProvidersPanel />}
      {tab === 'sohbet' && <ChatIntegrations />}
    </PlanGate>
  )
}
