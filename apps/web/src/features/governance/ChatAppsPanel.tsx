import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { AlertTriangle, Bot, Copy, Download, Pencil, Plus, Send, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { governanceApi, type ChatApp, type ChatAppInput, type ChatPlatform } from '@/api/governance'
import { formatRelativeToNow } from '@/lib/format'
import { useAction } from '@/features/shared/kit'
import { tx } from '@/lib/i18n'

function CopyLine({ label, value }: { label: string; value: string }) {
  const toast = useToast()
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px]">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px]">{value}</span>
      <button onClick={() => navigator.clipboard.writeText(value).then(() => toast.ok(tx('Kopyalandı')))} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label={tx('{0} kopyala', [label])}>
        <Copy className="size-3.5" />
      </button>
    </div>
  )
}

function saveJson(obj: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

const empty = (platform: ChatPlatform): ChatAppInput => ({
  platform,
  name: platform === 'Slack' ? 'HR360 Slack' : 'HR360 Teams',
  isEnabled: true,
  notifyApprovals: true,
  notifyRequesters: true,
  slackBotToken: '',
  slackSigningSecret: '',
  teamsAppId: '',
  teamsAppPassword: '',
  teamsAzureTenantId: '',
})

function SetupModal({ initial, editing, onClose }: { initial: ChatAppInput; editing?: ChatApp; onClose: () => void }) {
  const [f, setF] = useState(initial)
  const toast = useToast()
  const save = useAction(() => (editing ? governanceApi.updateChatApp(editing.id, f) : governanceApi.createChatApp(f)), {
    success: editing ? tx('Kaydedildi') : f.platform === 'Slack' ? tx('Slack uygulaması bağlandı') : tx('Teams botu bağlandı'),
    invalidate: [['chat-apps']],
    onDone: onClose,
  })
  const slack = f.platform === 'Slack'
  const ready = slack
    ? editing || ((f.slackBotToken ?? '').startsWith('xoxb-') && !!f.slackSigningSecret)
    : !!f.teamsAppId && !!f.teamsAzureTenantId && (editing || !!f.teamsAppPassword)
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={editing ? tx('{0} — düzenle', [editing.name]) : slack ? tx('Slack uygulaması bağla') : tx('Microsoft Teams botu bağla')}
      footer={<><Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button><Button disabled={!ready || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? tx('Doğrulanıyor…') : tx('Kaydet')}</Button></>}
    >
      <div className="space-y-5">
        {!editing && (
          <ol className="space-y-2 rounded-xl border border-border bg-muted/30 p-4 text-[12.5px] leading-relaxed">
            {slack ? (
              <>
                <li><b>1.</b> <a className="text-primary underline" href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">api.slack.com/apps</a> › <i>{tx('Create New App')}</i> › <i>{tx('From an app manifest')}</i>{tx('. Manifesti', [])}{' '}
                  <button className="cursor-pointer text-primary underline" onClick={async () => { const m = await governanceApi.slackManifest(undefined, f.name); await navigator.clipboard.writeText(JSON.stringify(m, null, 2)); toast.ok(tx('Manifest kopyalandı')) }}>{tx('kopyalayıp')}</button>{' '}{tx('yapıştırın.')}</li>
                <li><b>2.</b> <i>{tx('Install to Workspace')}</i>{' '}{tx('deyin.')}{' '}<i>{tx('OAuth & Permissions')}</i>{' '}{tx('sayfasındaki')}{' '}<b>{tx('Bot User OAuth Token')}</b>{tx('\'ı (xoxb-…) ve')}{' '}<i>{tx('Basic Information')}</i>{tx('\'daki')}{' '}<b>{tx('Signing Secret')}</b>{tx('\'ı aşağıya girin.')}</li>
                <li><b>3.</b>{' '}{tx('Kaydettikten sonra karttaki “Manifest” düğmesiyle güncel manifesti alıp Slack\'te')}{' '}<i>{tx('App Manifest')}</i>{' '}{tx('sayfasına yapıştırın (istek adresleri dolu gelir).')}</li>
              </>
            ) : (
              <>
                <li><b>1.</b>{' '}{tx('Azure Portal\'da')}{' '}<b>{tx('Azure Bot')}</b>{' '}{tx('oluşturun: tür')}{' '}<i>{tx('Single Tenant')}</i>. <i>{tx('Configuration')}</i>{' '}{tx('sayfasından')}{' '}<b>{tx('Microsoft App ID')}</b>{tx('\'yi, Entra ID › Overview\'dan')}{' '}<b>{tx('Tenant ID')}</b>{tx('\'yi alın.')}</li>
                <li><b>2.</b> <i>{tx('Manage Password')}</i> › <i>{tx('New client secret')}</i>{' '}{tx('ile gizli anahtar üretin. Üçünü aşağıya girin.')}</li>
                <li><b>3.</b>{' '}{tx('Kaydettikten sonra karttaki')}{' '}<b>{tx('Messaging endpoint')}</b>{tx('\'i Azure Bot › Configuration\'a yazın,')}{' '}<i>{tx('Channels')}</i>{tx('\'tan')}{' '}<b>{tx('Microsoft Teams')}</b>{tx('\'i ekleyin.')}</li>
                <li><b>4.</b>{' '}{tx('Karttaki “Teams paketi” ile indirilen zip\'i Teams yönetim merkezi ›')}{' '}<i>{tx('Manage apps')}</i> › <i>{tx('Upload')}</i>{' '}{tx('ile yükleyin. Kullanıcılar uygulamayı ekleyip bir kez yazınca onay bildirimleri gelmeye başlar.')}</li>
              </>
            )}
          </ol>
        )}
        <TextField label={tx('Ad')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        {slack ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tx('Bot User OAuth Token')} type="password" autoComplete="off" placeholder={editing ? tx('•••• (değiştirmek için girin)') : 'xoxb-…'} value={f.slackBotToken} onChange={(e) => setF({ ...f, slackBotToken: e.target.value })} />
            <TextField label={tx('Signing Secret')} type="password" autoComplete="off" placeholder={editing ? tx('•••• (değiştirmek için girin)') : ''} value={f.slackSigningSecret} onChange={(e) => setF({ ...f, slackSigningSecret: e.target.value })} />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={tx('Microsoft App ID')} value={f.teamsAppId} onChange={(e) => setF({ ...f, teamsAppId: e.target.value })} placeholder="00000000-0000-…" />
            <TextField label={tx('Dizin (kiracı) kimliği')} value={f.teamsAzureTenantId} onChange={(e) => setF({ ...f, teamsAzureTenantId: e.target.value })} placeholder="00000000-0000-…" />
            <TextField label={tx('İstemci gizli anahtarı')} type="password" autoComplete="off" placeholder={editing ? tx('•••• (değiştirmek için girin)') : ''} value={f.teamsAppPassword} onChange={(e) => setF({ ...f, teamsAppPassword: e.target.value })} />
          </div>
        )}
        <div className="space-y-2 text-[13px]">
          <label className="flex items-center gap-2"><Checkbox checked={f.notifyApprovals} onCheckedChange={(v) => setF({ ...f, notifyApprovals: v === true })} />{' '}{tx('Onaycılara “Onayla / Reddet” düğmeli mesaj gönder')}</label>
          <label className="flex items-center gap-2"><Checkbox checked={f.notifyRequesters} onCheckedChange={(v) => setF({ ...f, notifyRequesters: v === true })} />{' '}{tx('Talep sahibine sonucu bildir')}</label>
          <label className="flex items-center gap-2"><Checkbox checked={f.isEnabled} onCheckedChange={(v) => setF({ ...f, isEnabled: v === true })} />{' '}{tx('Etkin')}</label>
        </div>
        <p className="text-[12px] text-muted-foreground">{tx('Kaydederken bilgiler {0} ile doğrulanır. Jeton ve gizli anahtarlar şifreli saklanır, bir daha gösterilmez.', [slack ? tx('Slack') : tx('Microsoft')])}</p>
      </div>
    </Modal>
  )
}

function IdentitiesModal({ app, onClose }: { app: ChatApp; onClose: () => void }) {
  const q = useQuery({ queryKey: ['chat-identities', app.id], queryFn: ({ signal }) => governanceApi.chatIdentities(app.id, signal) })
  return (
    <Modal open onClose={onClose} size="lg" title={tx('{0} — kullanıcılar', [app.name])} note={tx('Eşleşme e-posta adresiyle yapılır: sohbet hesabının e-postası HR360\'taki çalışan e-postasıyla aynı olmalı.')}>
      {q.isPending ? <RowsSkeleton /> : (q.data ?? []).length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{app.platform === 'Teams' ? tx('Henüz botu ekleyen olmadı.') : tx('Henüz bir kullanıcıyla etkileşim olmadı.')}</p>
      ) : (
        <table className="w-full text-[12.5px]">
          <thead><tr className="border-b border-border text-left text-[11.5px] text-muted-foreground"><th className="py-2">{tx('Sohbet hesabı')}</th><th>{tx('Çalışan')}</th><th>{tx('Mesaj alabilir')}</th><th>{tx('Son görülme')}</th></tr></thead>
          <tbody>
            {q.data!.map((i) => (
              <tr key={i.id} className="border-b border-border/50 last:border-0">
                <td className="py-2"><p>{i.displayName ?? i.externalUserId}</p><p className="text-[11.5px] text-muted-foreground">{i.email ?? '—'}</p></td>
                <td>{i.employeeName ?? <StatusBadge tone="warning">{tx('Eşleşmedi')}</StatusBadge>}</td>
                <td>{i.canReceive ? <StatusBadge tone="success">{tx('Evet')}</StatusBadge> : <StatusBadge>{tx('Hayır')}</StatusBadge>}</td>
                <td className="text-muted-foreground">{i.lastSeenAt ? formatRelativeToNow(i.lastSeenAt) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

export function ChatAppsPanel() {
  const list = useQuery({ queryKey: ['chat-apps'], queryFn: ({ signal }) => governanceApi.chatApps(signal) })
  const [setup, setSetup] = useState<{ input: ChatAppInput; editing?: ChatApp } | null>(null)
  const [people, setPeople] = useState<ChatApp | null>(null)
  const test = useAction((id: string) => governanceApi.testChatApp(id), { success: tx('Deneme mesajı size gönderildi'), invalidate: [['chat-apps']] })
  const del = useAction((id: string) => governanceApi.deleteChatApp(id), { success: tx('Kaldırıldı'), invalidate: [['chat-apps']] })
  const httpsMissing = list.data?.some((a) => !a.publicOriginIsHttps) ?? false
  return (
    <div className="space-y-5">
      <InfoNote>
        {tx('Onaycılar izin, masraf ve diğer talepleri')}{' '}<b>{tx('Slack')}</b>{' '}{tx('ya da')}{' '}<b>{tx('Microsoft Teams')}</b>{tx('\'ten tek tıkla onaylar; talep sahibi sonucu aynı yerden öğrenir. Kişiler e-posta adresleriyle eşleşir. Komutlar:')}{' '}<code className="font-mono">{tx('onaylarım')}</code>, <code className="font-mono">{tx('bakiye')}</code>, <code className="font-mono">{tx('izindekiler')}</code>, <code className="font-mono">{tx('kimnerede')}</code>.
      </InfoNote>
      {httpsMissing && (
        <div className="flex items-start gap-2 rounded-xl border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3 text-[12.5px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]" />
          <span>{tx('Sunucunun genel adresi HTTPS değil. Slack ve Teams yalnızca internetten erişilebilen HTTPS adreslere istek gönderir; sunucuda')}{' '}<code className="font-mono">scripts/tls.sh enable</code>{' '}{tx('ile HTTPS açın.')}</span>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSetup({ input: empty('Slack') })}><Plus className="size-4" />{' '}{tx('Slack uygulaması')}</Button>
        <Button variant="outline" onClick={() => setSetup({ input: empty('Teams') })}><Plus className="size-4" />{' '}{tx('Microsoft Teams botu')}</Button>
      </div>
      {list.isPending ? <RowsSkeleton /> : (list.data ?? []).length === 0 ? (
        <EmptyState icon={Bot} title={tx('Bağlı sohbet uygulaması yok')} detail={tx('Bir Slack uygulaması ya da Teams botu bağlayın; onay talepleri kişilere düğmeli mesaj olarak gitsin.')} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {list.data!.map((a) => (
            <motion.div key={a.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="surface space-y-3 rounded-2xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">{a.platform === 'Slack' ? tx('Slack') : tx('Microsoft Teams')} · {a.name}</p>
                  <p className="text-[12px] text-muted-foreground">
                    {tx('{0} · {1} eşleşmiş kullanıcı{2}', [a.platform === 'Slack' ? tx('Çalışma alanı: {0}', [a.slackTeamName ?? '—']) : tx('App ID: {0}', [a.teamsAppId]), a.linkedUsers, a.lastActivityAt ? tx(' · son etkinlik {0}', [formatRelativeToNow(a.lastActivityAt)]) : ''])}
                  </p>
                </div>
                <StatusBadge tone={!a.isEnabled ? 'neutral' : a.lastError ? 'danger' : 'success'}>{!a.isEnabled ? tx('Kapalı') : a.lastError ? tx('Hata') : tx('Etkin')}</StatusBadge>
              </div>
              {a.lastError && <p className="rounded-lg bg-destructive/10 px-2.5 py-1.5 text-[12px] text-destructive">{a.lastError}</p>}
              <div className="space-y-1.5">
                {a.endpoints.commands && <CopyLine label={tx('Slash komutu')} value={a.endpoints.commands} />}
                {a.endpoints.interactivity && <CopyLine label={tx('Interactivity')} value={a.endpoints.interactivity} />}
                {a.endpoints.events && <CopyLine label={tx('Event Subscriptions')} value={a.endpoints.events} />}
                {a.endpoints.messaging && <CopyLine label={tx('Messaging endpoint')} value={a.endpoints.messaging} />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" onClick={() => test.mutate(a.id)}><Send className="size-4" />{' '}{tx('Bana deneme mesajı')}</Button>
                <Button size="sm" variant="outline" onClick={() => setPeople(a)}><Users className="size-4" />{' '}{tx('Kullanıcılar')}</Button>
                {a.platform === 'Slack'
                  ? <Button size="sm" variant="outline" onClick={async () => saveJson(await governanceApi.slackManifest(a.id), 'hr360-slack-manifest.json')}><Download className="size-4" />{' '}{tx('Manifest')}</Button>
                  : <Button size="sm" variant="outline" onClick={() => governanceApi.teamsPackage(a.id)}><Download className="size-4" />{' '}{tx('Teams paketi')}</Button>}
                <Button size="sm" variant="ghost" aria-label={tx('Düzenle')} onClick={() => setSetup({ editing: a, input: { ...empty(a.platform), name: a.name, isEnabled: a.isEnabled, notifyApprovals: a.notifyApprovals, notifyRequesters: a.notifyRequesters, teamsAppId: a.teamsAppId ?? '', teamsAzureTenantId: a.teamsAzureTenantId ?? '' } })}><Pencil className="size-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={tx('Sil')} onClick={() => del.mutate(a.id)}><Trash2 className="size-4" /></Button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
      {setup && <SetupModal initial={setup.input} editing={setup.editing} onClose={() => setSetup(null)} />}
      {people && <IdentitiesModal app={people} onClose={() => setPeople(null)} />}
    </div>
  )
}
