import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, FileSignature, KeyRound, ShieldAlert, ShieldCheck, Send } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Modal } from '@/components/ui/Modal'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge, type StatusTone } from '@/components/ui/StatusBadge'
import { EmptyState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { docSignatureApi, type SignatureEvidenceView, type SignatureRequestView, type SignatureStatus } from '@/api/docSignature'
import { documentTypeLabels, type DocumentType, type HrDocument } from '@/api/expense'
import { formatDateTime } from '@/lib/format'
import { useAction } from '@/features/shared/kit'
import { tx } from '@/lib/i18n'

/** Y28 — her imza ekranında görünen yasal açıklama (API'deki "disclaimer" ile aynı metin). */
export function SimpleSignatureDisclaimer() {
  return (
    <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-300">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      {tx('Basit elektronik imza — 5070 sayılı Kanun kapsamında nitelikli (güvenli) elektronik imza değildir.')}
    </p>
  )
}

const statusTone: Record<SignatureStatus, StatusTone> = { Pending: 'warning', Signed: 'success', Cancelled: 'neutral' }
export const signatureStatusLabel = (s: SignatureStatus) =>
  s === 'Pending' ? tx('İmza bekliyor') : s === 'Signed' ? tx('İmzalandı') : tx('İptal edildi')

export function SignatureStatusBadge({ status }: { status: SignatureStatus }) {
  return <StatusBadge tone={statusTone[status]}>{signatureStatusLabel(status)}</StatusBadge>
}

const channelLabel = (c: string) =>
  c === 'InApp+Email' ? tx('Uygulama içi bildirim + e-posta') : c === 'Email' ? tx('E-posta') : tx('Uygulama içi bildirim')

/** İmza kanıtı: belge özeti, imzalayan, zaman, maskeli IP, tarayıcı özeti, kod kanalı. */
export function EvidenceDetails({ e }: { e: SignatureEvidenceView }) {
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
        <dt className="text-muted-foreground">{tx('İmza zamanı')}</dt><dd>{formatDateTime(e.signedAt)}</dd>
        <dt className="text-muted-foreground">{tx('Yöntem')}</dt><dd>{tx('Tek kullanımlık kod (OTP)')}</dd>
        <dt className="text-muted-foreground">{tx('Kod kanalı')}</dt><dd>{channelLabel(e.otpChannel)}</dd>
        <dt className="text-muted-foreground">{tx('İmzalayan çalışan')}</dt><dd className="font-mono text-[11.5px]">{e.signerEmployeeId}</dd>
        <dt className="text-muted-foreground">{tx('Belge özeti (SHA-256)')}</dt><dd className="break-all font-mono text-[11px]">{e.documentHash}</dd>
        <dt className="text-muted-foreground">{tx('IP (son oktet maskeli)')}</dt><dd className="font-mono text-[11.5px]">{e.ipMasked ?? '—'}</dd>
        <dt className="text-muted-foreground">{tx('Tarayıcı özeti')}</dt><dd className="break-all font-mono text-[11px]">{e.userAgentHash ?? '—'}</dd>
        <dt className="text-muted-foreground">{tx('Kanıt özeti')}</dt><dd className="break-all font-mono text-[11px]">{e.evidenceHash}</dd>
      </dl>
      <p className="flex items-center gap-1.5 text-[12px]">
        {e.integrityOk
          ? <><ShieldCheck className="size-3.5 text-[hsl(var(--success))]" />{' '}{tx('Kanıt bütünlüğü doğrulandı')}</>
          : <><ShieldAlert className="size-3.5 text-destructive" />{' '}{tx('Kanıt özeti uyuşmuyor')}</>}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ İK: imzaya gönder */

export function SendForSignatureModal({ doc, onClose }: { doc: HrDocument; onClose: () => void }) {
  const [message, setMessage] = useState('')
  const send = useAction(() => docSignatureApi.request(doc.id, message.trim() || undefined), {
    success: tx('Belge imzaya gönderildi; çalışana bildirim iletildi'),
    invalidate: [['doc-signatures']],
    onDone: onClose,
  })
  return (
    <Modal
      open
      onClose={onClose}
      title={tx('İmzaya gönder')}
      note={doc.fileName}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button>
          <Button onClick={() => send.mutate(undefined)} disabled={send.isPending}><Send className="size-4" />{' '}{tx('Gönder')}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <SimpleSignatureDisclaimer />
        <TextAreaField label={tx('Çalışana not (isteğe bağlı)')} rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        <InfoNote>{tx('Çalışan belgeyi İmzalarım sayfasında görür ve tek kullanımlık kodla imzalar. İmzalanan belge değiştirilemez; yeniden imza için yeni talep gerekir.')}</InfoNote>
      </div>
    </Modal>
  )
}

/** İK: dokümanın imza talepleri ve kanıtları. */
export function DocumentSignaturesModal({ doc, onClose }: { doc: HrDocument; onClose: () => void }) {
  const q = useQuery({ queryKey: ['doc-signatures', doc.id], queryFn: ({ signal }) => docSignatureApi.forDocument(doc.id, signal) })
  const cancel = useAction((id: string) => docSignatureApi.cancel(id), { success: tx('İmza talebi iptal edildi'), invalidate: [['doc-signatures']] })
  return (
    <Modal open onClose={onClose} title={tx('İmza geçmişi')} note={doc.fileName} size="lg">
      <div className="space-y-4">
        <SimpleSignatureDisclaimer />
        {q.isPending ? <RowsSkeleton rows={2} /> : q.isError ? <p className="text-[13px] text-muted-foreground">{tx('İmza bilgileri alınamadı.')}</p> : (
          <>
            <p className="text-[12px] text-muted-foreground">
              {tx('Güncel belge özeti')}: <span className="break-all font-mono text-[11px]">{q.data.document.contentHash}</span>
            </p>
            {q.data.items.length === 0 ? <p className="text-[13px] text-muted-foreground">{tx('Bu doküman henüz imzaya gönderilmedi.')}</p> : q.data.items.map((r) => (
              <div key={r.id} className="space-y-3 rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SignatureStatusBadge status={r.status} />
                  <span className="text-[12.5px] text-muted-foreground">{tx('Gönderildi')}: {formatDateTime(r.createdAt)}</span>
                  {r.status === 'Pending' && (
                    <Button size="sm" variant="outline" className="ml-auto" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{tx('Talebi iptal et')}</Button>
                  )}
                </div>
                {r.message && <p className="text-[12.5px]">{r.message}</p>}
                {r.evidence && <EvidenceDetails e={r.evidence} />}
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}

/** İK listesi için: doküman → son imza durumu. */
export function useSignatureStatus(enabled = true) {
  return useQuery({
    queryKey: ['doc-signatures', 'status'],
    queryFn: ({ signal }) => docSignatureApi.statusSummary(signal),
    enabled,
    select: (rows) => new Map(rows.map((r) => [r.documentId, r])),
  })
}

/* ------------------------------------------------------------------ çalışan: imzala */

export function SignDocumentOtpModal({ req, onClose }: { req: SignatureRequestView; onClose: () => void }) {
  const [accepted, setAccepted] = useState(false)
  const [code, setCode] = useState('')
  const [sentInfo, setSentInfo] = useState<{ expiresAt: string; attemptsLeft: number } | null>(
    req.otp.sent && req.otp.expiresAt && new Date(req.otp.expiresAt) > new Date() ? { expiresAt: req.otp.expiresAt, attemptsLeft: req.otp.attemptsLeft } : null,
  )
  const [evidence, setEvidence] = useState<SignatureEvidenceView | null>(null)
  const sendOtp = useAction(() => docSignatureApi.sendOtp(req.id), {
    success: tx('Doğrulama kodu bildirimlerinize gönderildi'),
    onDone: (r) => setSentInfo({ expiresAt: r.expiresAt, attemptsLeft: r.attemptsLeft }),
  })
  const sign = useAction(() => docSignatureApi.sign(req.id, code.trim()), {
    success: tx('Belge imzalandı'),
    invalidate: [['doc-signatures']],
    onDone: (r) => setEvidence(r.evidence),
  })
  const d = req.document
  return (
    <Modal open onClose={onClose} title={evidence ? tx('İmza kanıtı') : tx('Belgeyi imzala')} note={d?.fileName} size="lg"
      footer={evidence ? <Button onClick={onClose}>{tx('Kapat')}</Button> : (
        <>
          <Button variant="outline" onClick={onClose}>{tx('Vazgeç')}</Button>
          <Button onClick={() => sign.mutate(undefined)} disabled={!accepted || !sentInfo || !/^[0-9]{6}$/.test(code.trim()) || sign.isPending}>
            <FileSignature className="size-4" />{' '}{tx('İmzala')}
          </Button>
        </>
      )}>
      <div className="space-y-4">
        <SimpleSignatureDisclaimer />
        {evidence ? <EvidenceDetails e={evidence} /> : (
          <>
            {d && (
              <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 rounded-xl border border-border p-3 text-[12.5px]">
                <dt className="text-muted-foreground">{tx('Belge')}</dt><dd className="font-medium">{d.fileName}</dd>
                <dt className="text-muted-foreground">{tx('Tür')}</dt><dd>{documentTypeLabels[d.type as DocumentType] ?? d.type}</dd>
                <dt className="text-muted-foreground">{tx('Kayıt tarihi')}</dt><dd>{formatDateTime(d.uploadedAt)}</dd>
                <dt className="text-muted-foreground">{tx('Dosya')}</dt><dd className="break-all">{d.storageKey || tx('dosya bağlı değil')}</dd>
                <dt className="text-muted-foreground">{tx('Belge özeti')}</dt><dd className="break-all font-mono text-[11px]">{d.contentHash}</dd>
              </dl>
            )}
            {req.message && <InfoNote>{req.message}</InfoNote>}
            <label className="flex items-start gap-2 text-[13px]">
              <Checkbox checked={accepted} onCheckedChange={(v) => setAccepted(v === true)} className="mt-0.5" />
              <span>{tx('Belgeyi inceledim; bunun basit elektronik imza olduğunu ve nitelikli elektronik imza yerine geçmediğini biliyorum.')}</span>
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <Button variant="outline" onClick={() => sendOtp.mutate(undefined)} disabled={!accepted || sendOtp.isPending}>
                <KeyRound className="size-4" />{' '}{sentInfo ? tx('Yeni kod gönder') : tx('Kod gönder')}
              </Button>
              <TextField label={tx('6 haneli kod')} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))} disabled={!sentInfo} className="w-36 font-mono tracking-[0.3em]" />
            </div>
            {sentInfo && (
              <p className="text-[12px] text-muted-foreground">
                {tx('Kod bildirimlerinize (ve e-postanıza) gönderildi. Son geçerlilik: {0}. Kalan deneme: {1}.', [formatDateTime(sentInfo.expiresAt), sentInfo.attemptsLeft])}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Çalışanın imza bekleyen ve imzaladığı belgeleri. */
export function MySignaturesPanel({ compact = false }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ['doc-signatures', 'mine'], queryFn: ({ signal }) => docSignatureApi.mine(signal) })
  const [open, setOpen] = useState<SignatureRequestView | null>(null)
  const items = q.data?.items ?? []
  if (compact && !items.some((r) => r.status === 'Pending')) return null
  return (
    <Panel>
      <PanelHead title={<span className="flex items-center gap-2"><FileSignature className="size-4 text-primary" />{' '}{tx('İmzanızı bekleyen belgeler')}</span>}
        note={tx('Belgeyi inceleyin, tek kullanımlık kodla imzalayın.')} />
      <PanelBody className="space-y-3">
        <SimpleSignatureDisclaimer />
        {q.isPending ? <RowsSkeleton rows={2} /> : q.isError ? <p className="text-[13px] text-muted-foreground">{tx('Belgeler alınamadı.')}</p> : items.length === 0 ? (
          <EmptyState title={tx('İmza bekleyen belge yok')} detail={tx('İK bir belgeyi imzanıza gönderdiğinde burada görünür.')} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {(compact ? items.filter((r) => r.status === 'Pending') : items).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{r.document?.fileName}</p>
                  <p className="text-[12px] text-muted-foreground">{r.status === 'Signed' ? tx('İmzalandı: {0}', [formatDateTime(r.signedAt)]) : tx('Gönderildi: {0}', [formatDateTime(r.createdAt)])}</p>
                </div>
                <SignatureStatusBadge status={r.status} />
                {r.status === 'Pending'
                  ? <Button size="sm" onClick={() => setOpen(r)}><FileSignature className="size-4" />{' '}{tx('İmzala')}</Button>
                  : r.evidence && <Button size="sm" variant="outline" onClick={() => setOpen(r)}><BadgeCheck className="size-4" />{' '}{tx('Kanıtı gör')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
      {open && (open.status === 'Pending'
        ? <SignDocumentOtpModal req={open} onClose={() => setOpen(null)} />
        : <Modal open onClose={() => setOpen(null)} title={tx('İmza kanıtı')} note={open.document?.fileName} size="lg">
            <div className="space-y-4"><SimpleSignatureDisclaimer />{open.evidence && <EvidenceDetails e={open.evidence} />}</div>
          </Modal>)}
    </Panel>
  )
}

/** /panel/imzalarim — tüm çalışanlara açık. */
export function MySignaturesPage() {
  return (
    <div className="space-y-5">
      <PageHeader title={tx('İmzalarım')} description={tx('İK tarafından imzanıza gönderilen belgeler ve imza kanıtlarınız.')} />
      <MySignaturesPanel />
    </div>
  )
}
