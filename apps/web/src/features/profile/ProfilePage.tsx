import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'motion/react'
import { CalendarPlus, Copy, Download, Eye, EyeOff, Fingerprint, KeyRound, RefreshCw, Save, ShieldCheck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { EmptyState, ErrorState, InfoNote, RowsSkeleton } from '@/components/ui/States'
import { Tabs, useTabParam } from '@/components/ui/Tabs'
import { useToast } from '@/components/ui/Toast'
import { apiFetch } from '@/api/client'
import { engagementApi, type MyProfile } from '@/api/engagement'
import { dataRequestLabels, governanceApi, type DataRequestKind } from '@/api/governance'
import { useAuth } from '@/auth/useAuth'
import { useMyEmployeeId } from '@/api/queries'
import { formatDate } from '@/lib/format'
import { ChipInput, Initials, errMsg, useAction } from '@/features/shared/kit'

type TabKey = 'bilgiler' | 'gizlilik' | 'takvim' | 'guvenlik'

const SKILL_HINTS = ['İletişim', 'Excel', 'Proje yönetimi', 'SQL', 'React', '.NET', 'Satış', 'Liderlik', 'İngilizce']

function SensitiveField({ label, field, employeeId, masked, has, onChange, value }: {
  label: string; field: 'iban' | 'nationalId'; employeeId: string; masked: string | null; has: boolean; value: string; onChange: (v: string) => void
}) {
  const toast = useToast()
  const [revealed, setRevealed] = useState<string | null>(null)
  const reveal = async () => {
    if (revealed) return setRevealed(null)
    try {
      const r = await engagementApi.reveal(employeeId, field)
      setRevealed(r.value ?? '')
    } catch (e) {
      toast.stop(errMsg(e))
    }
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={has ? (revealed ?? masked ?? '') : field === 'iban' ? 'TR00 0000 0000 0000 0000 0000 00' : '11 haneli'} className="font-mono" />
        </div>
        {has && (
          <Button type="button" variant="outline" size="icon" onClick={reveal} aria-label={revealed ? 'Gizle' : 'Göster'} title="Göster (denetim kaydına yazılır)">
            {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        )}
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        {has ? <>Kayıtlı: <span className="font-mono">{revealed ?? masked}</span> · açık hâli her görüntülemede denetim kaydına yazılır.</> : 'Boş bırakırsanız değişmez.'}
      </p>
    </div>
  )
}

function InfoTab({ p }: { p: MyProfile }) {
  const [f, setF] = useState({
    birthDate: p.birthDate ?? '', showBirthday: p.showBirthday, pronouns: p.pronouns ?? '', bio: p.bio ?? '', linkedInUrl: p.linkedInUrl ?? '',
    address: p.address ?? '', emergencyContactName: p.emergencyContactName ?? '', emergencyContactPhone: p.emergencyContactPhone ?? '',
    skills: p.skills, interests: p.interests, iban: '', nationalId: '',
  })
  const me = useQuery({ queryKey: ['my-employee-record'], queryFn: ({ signal }) => apiFetch<{ phone: string | null } | undefined>('/api/employee/employees/me?optional=true', { signal }).then((r) => r ?? null) })
  const [phone, setPhone] = useState('')
  useEffect(() => setPhone(me.data?.phone ?? ''), [me.data?.phone])
  const save = useAction(async () => {
    const r = await engagementApi.updateMyProfile({
      ...f, birthDate: f.birthDate || null, iban: f.iban.trim() || undefined, nationalId: f.nationalId.trim() || undefined,
    })
    if ((me.data?.phone ?? '') !== phone) await apiFetch('/api/employee/employees/me/contact', { method: 'PUT', body: { phone } })
    return r
  }, { success: 'Profiliniz güncellendi', invalidate: [['profile'], ['my-employee-record']], onDone: () => setF((x) => ({ ...x, iban: '', nationalId: '' })) })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(undefined) }} className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <PanelHead title="Kişisel bilgiler" note="Ad, e-posta ve işe giriş tarihi İK tarafından yönetilir." />
        <PanelBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Doğum tarihi" type="date" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} />
            <SelectField label="Hitap" value={f.pronouns || 'none'} onChange={(v) => set('pronouns', v === 'none' ? '' : v)} options={[{ value: 'none', label: 'Belirtmek istemiyorum' }, { value: 'O (kadın)', label: 'O (kadın)' }, { value: 'O (erkek)', label: 'O (erkek)' }]} />
          </div>
          <label className="flex items-center gap-2 text-[13px]"><Checkbox checked={f.showBirthday} onCheckedChange={(v) => set('showBirthday', v === true)} /> Doğum günüm kutlamalar sayfasında görünsün (yıl gösterilmez)</label>
          <TextField label="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+90 5xx xxx xx xx" />
          <TextAreaField label="Hakkımda" rows={3} maxLength={500} value={f.bio} onChange={(e) => set('bio', e.target.value)} />
          <TextField label="LinkedIn" value={f.linkedInUrl} onChange={(e) => set('linkedInUrl', e.target.value)} placeholder="https://linkedin.com/in/..." />
          <TextAreaField label="Adres" rows={2} value={f.address} onChange={(e) => set('address', e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Acil durumda aranacak kişi" value={f.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
            <TextField label="Acil durum telefonu" value={f.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} />
          </div>
        </PanelBody>
      </Panel>
      <div className="space-y-5">
        <Panel>
          <PanelHead title="Beceriler ve ilgi alanları" note="Yetenek dizininde ve mentor eşleştirmede kullanılır." />
          <PanelBody className="space-y-4">
            <ChipInput id="skills" label="Beceriler" value={f.skills} onChange={(v) => set('skills', v)} suggestions={SKILL_HINTS} />
            <ChipInput id="interests" label="İlgi alanları" value={f.interests} onChange={(v) => set('interests', v)} suggestions={['Fotoğraf', 'Koşu', 'Satranç', 'Müzik', 'Gönüllülük']} />
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHead title={<span className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Hassas bilgiler</span>} note="Maskeli gösterilir; yalnızca siz ve İK açık hâlini görebilir." />
          <PanelBody className="space-y-4">
            <SensitiveField label="IBAN (maaş hesabı)" field="iban" employeeId={p.employeeId} masked={p.iban} has={p.hasIban} value={f.iban} onChange={(v) => set('iban', v)} />
            <SensitiveField label="T.C. kimlik no" field="nationalId" employeeId={p.employeeId} masked={p.nationalId} has={p.hasNationalId} value={f.nationalId} onChange={(v) => set('nationalId', v)} />
          </PanelBody>
        </Panel>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.isPending}><Save className="size-4" /> Kaydet</Button>
        </div>
      </div>
    </form>
  )
}

function PrivacyTab({ employeeId }: { employeeId: string }) {
  const consents = useQuery({ queryKey: ['privacy', 'consents', 'me'], queryFn: ({ signal }) => governanceApi.myConsents(signal) })
  const requests = useQuery({ queryKey: ['privacy', 'requests'], queryFn: ({ signal }) => governanceApi.dataRequests(signal) })
  const record = useAction(({ type, granted }: { type: string; granted: boolean }) => governanceApi.recordConsent(type, granted), { success: 'Tercihiniz kaydedildi', invalidate: [['privacy']] })
  const [kind, setKind] = useState<DataRequestKind>('Access')
  const [details, setDetails] = useState('')
  const create = useAction(() => governanceApi.createDataRequest(kind, details), { success: 'Başvurunuz alındı; en geç 30 gün içinde yanıtlanır.', invalidate: [['privacy']], onDone: () => setDetails('') })
  const toast = useToast()
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel>
        <PanelHead title="Aydınlatma ve açık rıza" note="Rızalarınızı istediğiniz zaman geri alabilirsiniz (KVKK m.5, m.11)." />
        <PanelBody className="space-y-3">
          {consents.isPending ? <RowsSkeleton rows={3} /> : consents.data?.map((c) => (
            <div key={c.type} className="rounded-xl border border-border p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13.5px] font-medium">{c.title} {c.required && <span className="text-[11px] text-muted-foreground">(bilgilendirme)</span>}</p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{c.text}</p>
                </div>
                {c.granted == null ? <StatusBadge tone="warning">Bekliyor</StatusBadge> : c.granted ? <StatusBadge tone="success">{c.required ? 'Okundu' : 'Onaylı'}</StatusBadge> : <StatusBadge>Reddedildi</StatusBadge>}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {c.required ? (
                  <Button size="sm" variant={c.granted ? 'outline' : 'default'} onClick={() => record.mutate({ type: c.type, granted: true })}>Okudum, anladım</Button>
                ) : (
                  <>
                    <Button size="sm" variant={c.granted ? 'default' : 'outline'} onClick={() => record.mutate({ type: c.type, granted: true })}>Onaylıyorum</Button>
                    <Button size="sm" variant={c.granted === false ? 'default' : 'outline'} onClick={() => record.mutate({ type: c.type, granted: false })}>Onaylamıyorum</Button>
                  </>
                )}
                {c.recordedAt && <span className="text-[11.5px] text-muted-foreground">Son kayıt {formatDate(c.recordedAt)} · sürüm {c.version}</span>}
              </div>
            </div>
          ))}
        </PanelBody>
      </Panel>
      <div className="space-y-5">
        <Panel>
          <PanelHead title="Verilerim" note="HR360'ta sizinle ilgili tutulan tüm kişisel verilerin dökümü." />
          <PanelBody>
            <Button onClick={() => governanceApi.exportPersonalData(employeeId).catch((e) => toast.stop(errMsg(e)))}><Download className="size-4" /> Verilerimi indir (JSON)</Button>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHead title="İlgili kişi başvurusu" note="KVKK m.11 haklarınız için başvuru yapın." />
          <PanelBody className="space-y-3">
            <SelectField label="Başvuru türü" value={kind} onChange={(v) => setKind(v as DataRequestKind)} options={(Object.keys(dataRequestLabels) as DataRequestKind[]).map((k) => ({ value: k, label: dataRequestLabels[k] }))} />
            <TextAreaField label="Açıklama" rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
            <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>Başvur</Button>
            {(requests.data ?? []).length > 0 && (
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {requests.data!.map((r) => (
                  <li key={r.id} className="px-3.5 py-2.5 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span>{dataRequestLabels[r.kind]}</span>
                      <StatusBadge tone={r.status === 'Completed' ? 'success' : r.status === 'Rejected' ? 'danger' : r.overdue ? 'danger' : 'warning'}>
                        {r.status === 'Completed' ? 'Yanıtlandı' : r.status === 'Rejected' ? 'Reddedildi' : `${r.daysLeft} gün içinde`}
                      </StatusBadge>
                    </div>
                    {r.response && <p className="mt-1 text-[12.5px] text-muted-foreground">Yanıt: {r.response}</p>}
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}

function CalendarTab() {
  const toast = useToast()
  const feed = useQuery({ queryKey: ['calendar-feed'], queryFn: ({ signal }) => governanceApi.calendarFeed(signal) })
  const rotate = useAction(() => governanceApi.rotateCalendarFeed(), { success: 'Yeni bağlantı oluşturuldu; eski bağlantı artık çalışmaz.', invalidate: [['calendar-feed']] })
  const url = feed.data ? `${window.location.origin}${feed.data.path}` : ''
  return (
    <Panel className="max-w-3xl">
      <PanelHead title={<span className="flex items-center gap-2"><CalendarPlus className="size-4 text-primary" /> Takvim aboneliği (.ics)</span>} note="İzinleriniz, ekip izinleri, resmî tatiller, 1:1'ler ve masa rezervasyonlarınız takviminizde." />
      <PanelBody className="space-y-4">
        {feed.isPending ? <RowsSkeleton rows={1} /> : feed.isError ? <ErrorState message={(feed.error as Error).message} /> : (
          <>
            <div className="flex gap-2">
              <input readOnly value={url} className="h-10 flex-1 rounded-xl border border-input bg-muted/40 px-3 font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" onClick={() => navigator.clipboard.writeText(url).then(() => toast.ok('Kopyalandı'))}><Copy className="size-4" /> Kopyala</Button>
              <Button variant="outline" onClick={() => rotate.mutate(undefined)} title="Bağlantı sızdıysa yenileyin"><RefreshCw className="size-4" /></Button>
            </div>
            <ul className="space-y-1.5 text-[13px] text-muted-foreground">
              <li><b className="text-foreground">Google Takvim:</b> Diğer takvimler → URL ile ekle → bağlantıyı yapıştırın.</li>
              <li><b className="text-foreground">Outlook:</b> Takvim ekle → İnternetten abone ol.</li>
              <li><b className="text-foreground">Apple Takvim:</b> Dosya → Yeni takvim aboneliği.</li>
            </ul>
            <InfoNote>Bağlantı size özeldir ve oturum gerektirmez; kimseyle paylaşmayın. Sızdığını düşünüyorsanız yenileyin.</InfoNote>
          </>
        )}
      </PanelBody>
    </Panel>
  )
}

function SecurityTab() {
  const { accountUrl } = useAuth()
  return (
    <Panel className="max-w-3xl">
      <PanelHead title={<span className="flex items-center gap-2"><Fingerprint className="size-4 text-primary" /> İki adımlı doğrulama</span>} note="Parolanıza ek olarak telefonunuzdaki doğrulayıcı uygulamanın kodu istenir." />
      <PanelBody className="space-y-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-muted-foreground">
          <li>Telefonunuza Google Authenticator, Microsoft Authenticator veya FreeOTP kurun.</li>
          <li>Aşağıdaki düğmeyle hesap güvenliği sayfasına gidin ve “Doğrulayıcı uygulama” ekleyin.</li>
          <li>Ekrandaki QR kodu uygulamayla okutun ve üretilen 6 haneli kodu girin.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild><a href={`${accountUrl}#/account-security/signing-in`} target="_blank" rel="noreferrer"><KeyRound className="size-4" /> Hesap güvenliğini aç</a></Button>
          <Button asChild variant="outline"><a href={`${accountUrl}#/account-security/device-activity`} target="_blank" rel="noreferrer">Açık oturumlarım</a></Button>
        </div>
      </PanelBody>
    </Panel>
  )
}

export function ProfilePage() {
  const [tab, setTab] = useTabParam<TabKey>('sekme', 'bilgiler')
  const { employeeId, notLinked } = useMyEmployeeId()
  const q = useQuery({ queryKey: ['profile', 'me'], queryFn: ({ signal }) => engagementApi.myProfile(signal), retry: false, enabled: !!employeeId })
  const p = q.data
  return (
    <>
      <PageHeader title="Profilim" description="Kişisel bilgilerinizi, gizlilik tercihlerinizi ve takvim aboneliğinizi tek yerden yönetin." eyebrow={['Hesabım']} />
      {notLinked ? (
        <EmptyState title="Çalışan kaydınız yok" detail="Hesabınız bir çalışan kaydına bağlı değil (ör. yönetici hesabı). İK sizi çalışan olarak eklediğinde profil burada açılır." />
      ) : q.isPending ? <RowsSkeleton /> : q.isError || !p ? (
        <EmptyState title="Çalışan kaydınız yok" detail={q.error instanceof Error ? q.error.message : 'Hesabınız bir çalışan kaydına bağlı değil (ör. platform yöneticisi). İK sizi çalışan olarak eklediğinde profil burada açılır.'} />
      ) : (
        <>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="surface mb-6 flex flex-wrap items-center gap-4 rounded-3xl border border-border p-5">
            <Initials name={p.name} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="text-[20px] font-semibold tracking-tight">{p.name}</h2>
              <p className="text-[13.5px] text-muted-foreground">{p.position ?? 'Pozisyon atanmamış'} · {p.department ?? 'Departman yok'}</p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.email} · işe giriş {formatDate(p.hireDate)}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">{p.skills.slice(0, 6).map((s) => <span key={s} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] text-primary">{s}</span>)}</div>
          </motion.div>
          <div className="mb-5">
            <Tabs label="Profil bölümleri" value={tab} onChange={setTab} tabs={[{ key: 'bilgiler', label: 'Bilgilerim' }, { key: 'gizlilik', label: 'Gizlilik (KVKK)' }, { key: 'takvim', label: 'Takvim' }, { key: 'guvenlik', label: 'Güvenlik' }]} />
          </div>
          {tab === 'bilgiler' && <InfoTab key={p.updatedAt ?? 'new'} p={p} />}
          {tab === 'gizlilik' && <PrivacyTab employeeId={p.employeeId} />}
          {tab === 'takvim' && <CalendarTab />}
          {tab === 'guvenlik' && <SecurityTab />}
        </>
      )}
    </>
  )
}
