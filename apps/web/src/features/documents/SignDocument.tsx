import { useState } from 'react'
import { FileSignature, KeyRound, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextField } from '@/components/ui/Field'
import { InfoNote } from '@/components/ui/States'
import { platformGovApi, type OtpChallenge, type SignatureEvidence } from '@/api/platformGov'
import { formatDateTime } from '@/lib/format'
import { errMsg, useAction } from '@/features/shared/kit'
import { tx } from '@/lib/i18n'

/** Y28 — her imza ekranında görünen yasal uyarı. */
export function SimpleSignatureNotice() {
  return (
    <p className="flex gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-300">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
      {tx('Basit elektronik imza — 5070 sayılı Kanun kapsamında güvenli/nitelikli elektronik imza değildir')}
    </p>
  )
}

export function EvidenceView({ e }: { e: SignatureEvidence }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
      <dt className="text-muted-foreground">{tx('İmza zamanı')}</dt><dd>{formatDateTime(e.signedAt)}</dd>
      <dt className="text-muted-foreground">{tx('Yöntem')}</dt><dd>{e.method === 'OTP-Email' ? tx('E-postayla tek kullanımlık kod') : tx('Uygulama içi tek kullanımlık kod')}</dd>
      <dt className="text-muted-foreground">{tx('Belge / sürüm')}</dt><dd className="font-mono text-[11.5px]">{e.documentId.slice(0, 8)} · v{e.documentVersion}</dd>
      <dt className="text-muted-foreground">{tx('Belge özeti (SHA-256)')}</dt><dd className="break-all font-mono text-[11px]">{e.documentSha256}</dd>
      <dt className="text-muted-foreground">{tx('IP (kısaltılmış)')}</dt><dd>{e.ipPrefix ?? '—'}</dd>
      <dt className="text-muted-foreground">{tx('Kanıt özeti')}</dt><dd className="break-all font-mono text-[11px]">{e.evidenceSha256}</dd>
    </dl>
  )
}

/** Belgeyi tek kullanımlık kodla imzalama: kod iste → kodu gir → kanıt. */
export function SignDocumentModal({ docId, name, onClose }: { docId: string; name: string; onClose: () => void }) {
  const [channel, setChannel] = useState<'InApp' | 'Email'>('InApp')
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null)
  const [code, setCode] = useState('')
  const [evidence, setEvidence] = useState<SignatureEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useAction(() => platformGovApi.requestSignOtp(docId, channel), {
    success: tx('Kod gönderildi. Bildirimlerinizi kontrol edin.'),
    onDone: (c) => { setChallenge(c); setCode(''); setError(null) },
  })
  const sign = useAction(() => platformGovApi.sign(docId, challenge!.otpId, code.trim()), {
    success: tx('Belge imzalandı'), invalidate: [['doc-requests']],
    onDone: (e) => { setEvidence(e); setError(null) },
  })
  const submit = () => sign.mutateAsync(undefined).catch((e) => setError(errMsg(e)))
  return (
    <Modal open onClose={onClose} title={tx('Kodla imzala: {0}', [name])} note={tx('Tek kullanımlık kod 10 dakika geçerlidir; en fazla 5 deneme hakkınız var.')}
      footer={evidence ? <Button onClick={onClose}>{tx('Kapat')}</Button> : !challenge ? (
        <Button disabled={request.isPending} onClick={() => request.mutate(undefined)}><KeyRound className="size-4" /> {tx('Kod gönder')}</Button>
      ) : (
        <>
          <Button variant="outline" disabled={request.isPending} onClick={() => request.mutate(undefined)}>{tx('Yeni kod')}</Button>
          <Button disabled={sign.isPending || !/^\d{6}$/.test(code.trim())} onClick={() => void submit()}><FileSignature className="size-4" /> {tx('İmzala')}</Button>
        </>
      )}>
      <div className="space-y-3">
        <SimpleSignatureNotice />
        {evidence ? (
          <>
            <InfoNote>{tx('İmza kanıtı kaydedildi; belge doğrulama sayfasında da görünür. Kanıt, belgenin saklama süresi boyunca tutulur.')}</InfoNote>
            <EvidenceView e={evidence} />
          </>
        ) : !challenge ? (
          <SelectField label={tx('Kod nereye gönderilsin?')} value={channel} onChange={(v) => setChannel(v as 'InApp' | 'Email')}
            options={[{ value: 'InApp', label: tx('Uygulama içi bildirim') }, { value: 'Email', label: tx('E-posta') }]} />
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground">{challenge.channel === 'Email' ? tx('Kod e-posta adresinize gönderildi.') : tx('Kod uygulama içi bildirimlerinize gönderildi.')} {tx('Son geçerlilik: {0}', [formatDateTime(challenge.expiresAt)])}</p>
            <TextField label={tx('6 haneli kod')} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" error={error ?? undefined} />
          </>
        )}
      </div>
    </Modal>
  )
}
