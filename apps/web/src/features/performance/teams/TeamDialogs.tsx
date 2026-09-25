/**
 * Ekip yönetimi diyalogları: ekip oluştur/düzenle, lider ata, üye ekle,
 * üye çıkar. Her biri backend'in `{ message }` hatasını olduğu gibi gösterir.
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Crown, History, Info, TriangleAlert, UserMinus, UserPlus } from 'lucide-react'
import {
  useAddTeamMember,
  useCreateTeam,
  useRemoveTeamMember,
  useSetTeamLead,
  useUpdateTeam,
  type Team,
  type TeamMember,
} from '@/api/performance'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { formatDate } from '@/lib/format'
import { Switch, errorText } from '../components/controls'
import { PersonAvatar, PersonPicker } from '../components/people'
import type { DeptNode, PickerPerson } from '../hooks'
import { localISODate } from '@/lib/dates'

const today = () => localISODate()

function ErrorLine({ message }: { message: string | null }) {
  return (
    <AnimatePresence>
      {message && (
        <motion.p
          role="alert"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="mb-4 flex items-start gap-2 overflow-hidden rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

/* ------------------------------ Ekip oluştur / düzenle ----------------------------- */

export function TeamFormDialog({
  team,
  departments,
  defaultDepartmentId,
  onClose,
  onSaved,
}: {
  team: Team | null
  departments: DeptNode[]
  defaultDepartmentId?: string | null
  onClose: () => void
  onSaved?: (team: Team) => void
}) {
  const toast = useToast()
  const create = useCreateTeam()
  const update = useUpdateTeam()
  const [name, setName] = useState(team?.name ?? '')
  const [description, setDescription] = useState(team?.description ?? '')
  const [departmentId, setDepartmentId] = useState(team?.departmentId ?? defaultDepartmentId ?? departments[0]?.id ?? '')
  const [isActive, setIsActive] = useState(team?.isActive ?? true)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const multiCompany = new Set(departments.map((d) => d.companyName)).size > 1
  const pending = create.isPending || update.isPending

  const nameError = !name.trim() ? 'Ekibe bir ad verin.' : undefined
  const submit = () => {
    setTouched(true)
    if (nameError || !departmentId) return
    const done = (t: Team) => {
      toast.ok(team ? `«${t.name}» güncellendi.` : `«${t.name}» ekibi oluşturuldu.`)
      onSaved?.(t)
      onClose()
    }
    // Backend güncellemede yalnızca ad, açıklama ve etkinlik alır; departman sonradan değişmez.
    if (team) update.mutate({ id: team.id, input: { name: name.trim(), description: description.trim() || null, isActive } }, { onSuccess: done, onError: (e) => setError(errorText(e)) })
    else create.mutate({ name: name.trim(), description: description.trim() || null, departmentId }, { onSuccess: done, onError: (e) => setError(errorText(e)) })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={team ? 'Ekibi düzenle' : 'Yeni ekip'}
      note={team ? undefined : 'Ekip bir departmana bağlıdır. Lider ve üyeleri oluşturduktan sonra eklersiniz.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Kaydediliyor…' : team ? 'Kaydet' : 'Ekibi oluştur'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <div className="flex flex-col gap-4">
        <TextField label="Ekip adı" value={name} onChange={(e) => { setName(e.target.value); setError(null) }} error={touched ? nameError : undefined} placeholder="ör. Platform Ekibi" autoFocus required />
        {team ? (
          <div>
            <p className="text-[13px] font-medium">Departman</p>
            <p className="mt-1.5 rounded-md border border-border bg-muted/40 px-3 py-2 text-[13px]">{departments.find((d) => d.id === departmentId)?.path ?? '—'}</p>
            <p className="mt-1.5 text-[12px] text-muted-foreground">Ekibin departmanı oluşturulduktan sonra değiştirilemez.</p>
          </div>
        ) : (
          <SelectField
            label="Departman"
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((d) => ({ value: d.id, label: `${multiCompany ? `${d.companyName} · ` : ''}${d.path}` }))}
            hint="Hiyerarşi: Şirket → Departman (→ alt departman) → Ekip → Üyeler. Departman sonradan değiştirilemez."
          />
        )}
        <TextAreaField label="Açıklama" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ekip neden var, neyden sorumlu?" />
        {team && (
          <Switch
            checked={isActive}
            onChange={setIsActive}
            label="Ekip etkin"
            hint={isActive ? 'Etkin ekipler diyagramda ve seçimlerde görünür.' : 'Pasif ekip diyagramda gizlenir, yeni üye alınamaz. Üyelik geçmişi ve analizler korunur.'}
          />
        )}
      </div>
    </Modal>
  )
}

/* ---------------------------------- Lider ata ---------------------------------- */

export function LeadDialog({
  team,
  members,
  people,
  nameOf,
  detailOf,
  onClose,
}: {
  team: Team
  members: TeamMember[]
  people: PickerPerson[]
  nameOf: (id: string) => string
  detailOf: (id: string) => string | null
  onClose: () => void
}) {
  const toast = useToast()
  const setLead = useSetTeamLead()
  const [picked, setPicked] = useState<string | null>(team.leadEmployeeId)
  const [error, setError] = useState<string | null>(null)
  const activeIds = new Set(members.filter((m) => !m.leftOn).map((m) => m.employeeId))
  const pickedIsMember = picked ? activeIds.has(picked) : true
  const name = nameOf

  const run = (lead: string | null) =>
    setLead.mutate(
      { id: team.id, leadEmployeeId: lead },
      {
        onSuccess: () => {
          toast.ok(lead ? `${name(lead)} takım lideri oldu${activeIds.has(lead) ? '' : ' ve ekibe eklendi'}.` : 'Ekip artık lidersiz; kişi üye olarak kaldı.')
          onClose()
        },
        onError: (e) => setError(errorText(e)),
      },
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={team.leadEmployeeId ? 'Takım liderini değiştir' : 'Takım lideri ata'}
      note="Lider opsiyoneldir. Atanan kişi ekipte değilse otomatik olarak üye olarak eklenir."
      footer={
        <>
          {team.leadEmployeeId && (
            <Button variant="ghost" className="sm:mr-auto" onClick={() => run(null)} disabled={setLead.isPending}>
              Lideri kaldır
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={setLead.isPending}>
            Vazgeç
          </Button>
          <Button onClick={() => picked && run(picked)} disabled={!picked || picked === team.leadEmployeeId || setLead.isPending}>
            <Crown aria-hidden />
            {setLead.isPending ? 'Kaydediliyor…' : 'Lider yap'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <PersonPicker
        people={people}
        value={picked}
        onChange={(id) => {
          setPicked(id)
          setError(null)
        }}
        note={(id) => (id === team.leadEmployeeId ? 'şu anki lider' : activeIds.has(id) ? 'üye' : null)}
        detailOf={detailOf}
      />
      <AnimatePresence>
        {picked && !pickedIsMember && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 flex items-start gap-2 overflow-hidden rounded-lg bg-primary/5 px-3 py-2 text-[12px] text-foreground"
          >
            <Info className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            {name(picked)} bu ekipte değil; lider atanınca bugünün tarihiyle ekibe üye olarak da eklenecek.
          </motion.p>
        )}
      </AnimatePresence>
      {team.leadEmployeeId && (
        <p className="mt-3 text-[12px] text-muted-foreground">Lideri kaldırırsanız kişi ekipte üye olarak kalır; ekip lidersiz devam eder.</p>
      )}
    </Modal>
  )
}

/* ---------------------------------- Üye ekle ---------------------------------- */

export function AddMemberDialog({
  team,
  members,
  people,
  nameOf,
  detailOf,
  otherTeamOf,
  onClose,
}: {
  team: Team
  members: TeamMember[]
  people: PickerPerson[]
  nameOf: (id: string) => string
  detailOf: (id: string) => string | null
  /** Kişinin başka bir etkin ekibi varsa adı — bilgi amaçlı. */
  otherTeamOf: (id: string) => string | null
  onClose: () => void
}) {
  const toast = useToast()
  const add = useAddTeamMember()
  const [picked, setPicked] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [joinedOn, setJoinedOn] = useState(today())
  const [error, setError] = useState<string | null>(null)
  const activeIds = members.filter((m) => !m.leftOn).map((m) => m.employeeId)

  const submit = () => {
    if (!picked) return
    add.mutate(
      { id: team.id, input: { employeeId: picked, roleInTeam: role.trim() || undefined, joinedOn } },
      {
        onSuccess: () => {
          toast.ok(`${nameOf(picked)} «${team.name}» ekibine eklendi.`)
          onClose()
        },
        onError: (e) => setError(errorText(e)),
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`«${team.name}» ekibine üye ekle`}
      note="Bir çalışan birden fazla ekipte olabilir."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={add.isPending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={!picked || add.isPending}>
            <UserPlus aria-hidden />
            {add.isPending ? 'Ekleniyor…' : 'Üye ekle'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <PersonPicker
          people={people}
          value={picked}
          onChange={(id) => {
            setPicked(id)
            setError(null)
          }}
          exclude={activeIds}
          note={otherTeamOf}
          detailOf={detailOf}
        />
        <div className="flex flex-col gap-4">
          <TextField label="Ekipteki rolü" value={role} onChange={(e) => setRole(e.target.value)} placeholder="ör. Backend" hint="Opsiyonel." />
          <TextField label="Katılım tarihi" type="date" value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

/* ---------------------------------- Üye çıkar ---------------------------------- */

export function RemoveMemberDialog({
  team,
  member,
  name,
  onClose,
}: {
  team: Team
  member: TeamMember
  name: string
  onClose: () => void
}) {
  const toast = useToast()
  const remove = useRemoveTeamMember()
  const [leftOn, setLeftOn] = useState(today())
  const [error, setError] = useState<string | null>(null)
  const isLead = team.leadEmployeeId === member.employeeId
  const invalidDate = leftOn < member.joinedOn

  const submit = () =>
    remove.mutate(
      { id: team.id, memberId: member.id, leftOn },
      {
        onSuccess: () => {
          toast.ok(`${name} ekipten ayrıldı (${formatDate(leftOn)}). Kayıt "Eski üyeler" altında duruyor.`)
          onClose()
        },
        onError: (e) => setError(errorText(e)),
      },
    )

  return (
    <Modal
      open
      onClose={onClose}
      title={`${name} ekipten çıkarılsın mı?`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={remove.isPending}>
            Vazgeç
          </Button>
          <Button onClick={submit} disabled={remove.isPending || invalidDate}>
            <UserMinus aria-hidden />
            {remove.isPending ? 'Kaydediliyor…' : 'Ayrılma tarihini yaz'}
          </Button>
        </>
      }
    >
      <ErrorLine message={error} />
      <div className="mb-4 flex items-center gap-3 rounded-lg border border-border p-3">
        <PersonAvatar id={member.employeeId} name={name} size="md" />
        <div>
          <p className="text-[14px] font-semibold">{name}</p>
          <p className="text-[12px] text-muted-foreground">
            {team.name} · {formatDate(member.joinedOn)} tarihinden beri{member.roleInTeam ? ` · ${member.roleInTeam}` : ''}
          </p>
        </div>
      </div>
      <p className="mb-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
        <History className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        Üyelik kaydı silinmez; yalnızca ayrılma tarihi yazılır. "Eski üyeleri göster" ile her zaman görülebilir, geçmiş değerlendirmeler ve ekip
        analizleri korunur.
      </p>
      {isLead && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-[hsl(var(--warning))]/30 bg-[hsl(var(--warning))]/8 px-3 py-2 text-[12px]">
          <Crown className="mt-0.5 size-3.5 shrink-0 text-[hsl(var(--warning))]" aria-hidden />
          Bu kişi takım lideri. Çıkarıldığında ekip lidersiz kalır.
        </p>
      )}
      <TextField
        label="Ayrılma tarihi"
        type="date"
        value={leftOn}
        min={member.joinedOn}
        onChange={(e) => setLeftOn(e.target.value)}
        error={invalidDate ? 'Ayrılma tarihi katılma tarihinden önce olamaz.' : undefined}
      />
    </Modal>
  )
}
