import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ProgressBar } from '@/components/ui/Progress'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { EmptyState, ErrorState, RowsSkeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { learningApi } from '@/api/learning'
import {
  useCertifications,
  useCompliance,
  useCourses,
  useExpiringCertifications,
} from '@/api/queries'
import {
  courseCategoryLabels,
  type Certification,
  type Course,
  type CourseCategory,
} from '@/api/types'
import { formatDate, formatNumber } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'
import { cn } from '@/lib/utils'
import { tx } from '@/lib/i18n'

type TabKey = 'katalog' | 'sertifikalar' | 'suresi-dolan' | 'uyum'

const ALL = '__all__'

function NewCourseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [provider, setProvider] = useState('')
  const [durationHours, setDuration] = useState('4')
  const [category, setCategory] = useState<CourseCategory>('Technical')
  const [isMandatory, setMandatory] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      learningApi.createCourse({
        title: title.trim(),
        description: description.trim() || undefined,
        provider: provider.trim() || undefined,
        durationHours: Number(durationHours) || 1,
        category,
        isMandatory,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning'] })
      toast.ok(tx('Eğitim eklendi'))
      onClose()
      setTitle('')
      setDescription('')
      setProvider('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : tx('Eğitim eklenemedi.')),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim().length < 3) return setError(tx('Eğitim adı en az 3 karakter olmalı.'))
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx('Yeni eğitim')}
      note={tx('Zorunlu işaretlenen eğitimler uyum raporunda takip edilir.')}
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            type="submit"
            form="new-course"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Eğitimi ekle')}
          </Button>
        </>
      }
    >
      <form id="new-course" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          id="course-title"
          label={tx('Eğitim adı')}
          required
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          error={error}
        />
        <TextAreaField
          id="course-desc"
          label={tx('Açıklama')}
          rows={3}
          hint={tx('İsteğe bağlı')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            id="course-category"
            label={tx('Kategori')}
            value={category}
            onChange={(v) => setCategory(v as CourseCategory)}
            options={(Object.keys(courseCategoryLabels) as CourseCategory[]).map((c) => ({
              value: c,
              label: courseCategoryLabels[c],
            }))}
          />
          <TextField
            id="course-duration"
            label={tx('Süre (saat)')}
            type="number"
            min={1}
            className="tabular"
            value={durationHours}
            onChange={(e) => setDuration(e.target.value)}
          />
          <TextField
            id="course-provider"
            label={tx('Sağlayıcı')}
            hint={tx('İsteğe bağlı')}
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          />
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={isMandatory}
            onCheckedChange={(v) => setMandatory(v === true)}
            className="mt-0.5"
          />
          <span className="text-[13px]">
            {tx('Zorunlu eğitim')}
            <span className="block text-[12px] text-muted-foreground">
              {tx('Uyum raporunda takip edilir.')}
            </span>
          </span>
        </label>
      </form>
    </Modal>
  )
}

function EnrollModal({
  courseId,
  courseTitle,
  onClose,
}: {
  courseId: string | null
  courseTitle: string
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () => learningApi.enroll(courseId!, employeeId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning'] })
      toast.ok(tx('Kayıt oluşturuldu'))
      onClose()
      setEmployeeId('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : tx('Kayıt oluşturulamadı.')),
  })

  if (!courseId) return null

  return (
    <Modal
      open
      onClose={onClose}
      title={tx('Eğitime kaydol')}
      note={courseTitle}
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            className="cursor-pointer"
            disabled={mutation.isPending}
            onClick={() => (employeeId ? mutation.mutate() : setError(tx('Çalışan seçilmeli.')))}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Kaydol')}
          </Button>
        </>
      }
    >
      <EmployeePicker
        id="enroll-employee"
        value={employeeId}
        onChange={setEmployeeId}
        hint={error}
      />
    </Modal>
  )
}

function NewCertificationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [name, setName] = useState('')
  const [issuer, setIssuer] = useState('')
  const [credentialId, setCredential] = useState('')
  const [issuedOn, setIssued] = useState('')
  const [expiresOn, setExpires] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      learningApi.createCertification({
        employeeId,
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        credentialId: credentialId.trim() || undefined,
        issuedOn,
        expiresOn: expiresOn || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['learning'] })
      toast.ok(tx('Sertifika kaydedildi'))
      onClose()
      setName('')
      setIssuer('')
      setCredential('')
      setIssued('')
      setExpires('')
    },
    onError: (e: unknown) =>
      toast.stop(e instanceof Error ? e.message : tx('Sertifika kaydedilemedi.')),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) return setError(tx('Çalışan seçilmeli.'))
    if (name.trim().length < 2) return setError(tx('Sertifika adı en az 2 karakter olmalı.'))
    if (!issuedOn) return setError(tx('Veriliş tarihi zorunlu.'))
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tx('Yeni sertifika')}
      note={tx('Geçerlilik bitişi girilirse süresi dolanlar sekmesinde takip edilir.')}
      size="lg"
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {tx('Vazgeç')}
          </Button>
          <Button
            type="submit"
            form="new-cert"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            {tx('Kaydet')}
          </Button>
        </>
      }
    >
      <form id="new-cert" onSubmit={submit} noValidate className="space-y-4">
        <EmployeePicker
          id="cert-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint={error?.includes('Çalışan') ? error : undefined}
        />
        <TextField
          id="cert-name"
          label={tx('Sertifika adı')}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={error?.includes('Sertifika adı') ? error : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="cert-issuer"
            label={tx('Veren kurum')}
            hint={tx('İsteğe bağlı')}
            value={issuer}
            onChange={(e) => setIssuer(e.target.value)}
          />
          <TextField
            id="cert-credential"
            label={tx('Belge no')}
            hint={tx('İsteğe bağlı')}
            value={credentialId}
            onChange={(e) => setCredential(e.target.value)}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="cert-issued"
            label={tx('Veriliş tarihi')}
            type="date"
            required
            value={issuedOn}
            onChange={(e) => setIssued(e.target.value)}
            error={error?.includes('Veriliş') ? error : undefined}
          />
          <TextField
            id="cert-expires"
            label={tx('Geçerlilik bitişi')}
            type="date"
            hint={tx('Boş bırakılırsa süresiz')}
            value={expiresOn}
            onChange={(e) => setExpires(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  )
}

/** Süresi dolan sertifika satırı — kalan güne göre kırmızı/sarı. */
function ExpiringRow({ cert }: { cert: Certification }) {
  const nameOf = useEmployeeName()
  const days = cert.daysRemaining ?? 0
  const expired = cert.expired ?? days < 0

  return (
    <li
      className={cn(
        'flex flex-wrap items-baseline gap-x-4 gap-y-1.5 border-l-2 px-4 py-3.5',
        expired
          ? 'border-destructive bg-destructive/5'
          : days <= 30
            ? 'border-[hsl(var(--warning))]'
            : 'border-transparent',
      )}
    >
      <span className="min-w-0 flex-1 basis-52">
        <span className="block truncate text-[14px] font-medium">{cert.name}</span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {nameOf(cert.employeeId)}, {cert.issuer ? `${cert.issuer}, ` : ''}
          {cert.expiresOn ? tx('bitiş {0}', [formatDate(cert.expiresOn)]) : tx('süresiz')}
        </span>
      </span>
      <StatusBadge tone={expired ? 'danger' : days <= 30 ? 'warning' : 'neutral'}>
        {expired ? tx('{0} gün önce doldu', [Math.abs(days)]) : tx('{0} gün kaldı', [days])}
      </StatusBadge>
    </li>
  )
}

export function LearningPage() {
  const { can } = useAuth()
  const [tab, setTab] = useTabParam<TabKey>('gorunum', 'katalog')
  const [category, setCategory] = useState<string>(ALL)
  const [mandatoryOnly, setMandatoryOnly] = useState(false)
  const [courseModal, setCourseModal] = useState(false)
  const [certModal, setCertModal] = useState(false)
  const [enrollFor, setEnrollFor] = useState<{ id: string; title: string } | null>(null)

  const canManage = can('learning:manage')
  // Süresi dolan sertifikalar listesi backend'de yöneticiye ve üstüne açık.
  const canSeeExpiring = can('employee:viewAll')

  const courses = useCourses({
    category: category === ALL ? undefined : (category as CourseCategory),
    mandatoryOnly: mandatoryOnly || undefined,
  })
  const certifications = useCertifications()
  const expiring = useExpiringCertifications(90, tab === 'suresi-dolan' && canSeeExpiring)
  const compliance = useCompliance(tab === 'uyum' && canManage)
  const nameOf = useEmployeeName()

  const tabs: Array<TabDef<TabKey>> = [
    { key: 'katalog', label: tx('Katalog') },
    { key: 'sertifikalar', label: tx('Sertifikalar') },
    ...(canSeeExpiring
      ? [{ key: 'suresi-dolan' as TabKey, label: tx('Süresi dolanlar'), count: expiring.data?.length }]
      : []),
    ...(canManage ? [{ key: 'uyum' as TabKey, label: tx('Zorunlu eğitim uyumu') }] : []),
  ]

  const courseFilters: TableFilter[] = [
    {
      id: 'category',
      label: tx('Kategori'),
      value: category,
      onChange: setCategory,
      options: [
        { value: ALL, label: tx('Tüm kategoriler') },
        ...(Object.keys(courseCategoryLabels) as CourseCategory[]).map((c) => ({
          value: c,
          label: courseCategoryLabels[c],
        })),
      ],
    },
  ]

  const courseColumns: Array<Column<Course>> = [
    {
      id: 'title',
      header: tx('Eğitim'),
      searchText: (c) => `${c.title} ${c.description ?? ''} ${c.provider ?? ''}`,
      sortValue: (c) => c.title,
      exportText: (c) => c.title,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{c.title}</p>
          {c.description && (
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {c.description}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'category',
      header: tx('Kategori'),
      hideBelow: 'sm',
      sortValue: (c) => courseCategoryLabels[c.category] ?? '',
      exportText: (c) => courseCategoryLabels[c.category] ?? '',
      cell: (c) => (
        <span className="text-muted-foreground">{courseCategoryLabels[c.category]}</span>
      ),
    },
    {
      id: 'provider',
      header: tx('Sağlayıcı'),
      hideBelow: 'lg',
      searchText: (c) => c.provider ?? '',
      exportText: (c) => c.provider ?? '—',
      cell: (c) => <span className="text-muted-foreground">{c.provider ?? '—'}</span>,
    },
    {
      id: 'duration',
      header: tx('Süre'),
      align: 'right',
      hideBelow: 'md',
      sortValue: (c) => c.durationHours,
      exportText: (c) => `${c.durationHours} saat`,
      cell: (c) => `${formatNumber(c.durationHours)} saat`,
    },
    {
      id: 'mandatory',
      header: tx('Zorunlu'),
      align: 'right',
      sortValue: (c) => (c.isMandatory ? 1 : 0),
      exportText: (c) => (c.isMandatory ? 'Evet' : tx('Hayır')),
      cell: (c) =>
        c.isMandatory ? (
          <StatusBadge tone="warning">{tx('Zorunlu')}</StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]

  const certColumns: Array<Column<Certification>> = [
    {
      id: 'name',
      header: tx('Sertifika'),
      searchText: (c) => `${c.name} ${c.issuer ?? ''} ${c.credentialId ?? ''}`,
      sortValue: (c) => c.name,
      exportText: (c) => c.name,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{c.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {c.issuer ?? tx('kurum belirtilmemiş')}
            {c.credentialId ? tx(', belge no {0}', [c.credentialId]) : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'employee',
      header: tx('Çalışan'),
      hideBelow: 'sm',
      searchText: (c) => nameOf(c.employeeId),
      sortValue: (c) => nameOf(c.employeeId),
      exportText: (c) => nameOf(c.employeeId),
      cell: (c) => <span className="text-muted-foreground">{nameOf(c.employeeId)}</span>,
    },
    {
      id: 'validity',
      header: tx('Geçerlilik'),
      align: 'right',
      hideBelow: 'md',
      sortValue: (c) => new Date(c.issuedOn).getTime(),
      exportText: (c) =>
        `${formatDate(c.issuedOn)}${c.expiresOn ? ` – ${formatDate(c.expiresOn)}` : ''}`,
      cell: (c) => (
        <span className="tabular text-muted-foreground">
          {formatDate(c.issuedOn)}
          {c.expiresOn ? ` – ${formatDate(c.expiresOn)}` : ''}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={tx('Eğitim')}
        description={tx('Eğitim kataloğu, kayıtlar ve sertifika takibi.')}
        actions={
          <>
{canManage && (
                          <Button variant="outline" className="cursor-pointer" onClick={() => setCertModal(true)}>
                <Plus className="size-4" />
                {tx('Sertifika ekle')}
              </Button>
            )}
            {canManage && (
              <Button className="cursor-pointer" onClick={() => setCourseModal(true)}>
                <Plus className="size-4" />
                {tx('Yeni eğitim')}
              </Button>
            )}
          </>
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} label={tx('Eğitim görünümü')} />

      {tab === 'katalog' && (
        <DataTable
          rows={courses.data}
          rowKey={(c) => c.id}
          columns={courseColumns}
          filters={courseFilters}
          isLoading={courses.isPending}
          error={courses.error}
          onRetry={() => void courses.refetch()}
          searchPlaceholder={tx('Eğitim adı, açıklama veya sağlayıcı')}
          exportFileName="egitim-katalogu"
          emptyTitle={tx('Eğitim yok')}
          emptyDetail={tx('Bu filtreye uyan eğitim bulunmuyor.')}
          emptyAction={
            canManage ? (
              <Button size="sm" className="cursor-pointer" onClick={() => setCourseModal(true)}>
                {tx('Yeni eğitim')}
              </Button>
            ) : undefined
          }
          toolbarActions={
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox
                checked={mandatoryOnly}
                onCheckedChange={(v) => setMandatoryOnly(v === true)}
              />
              <span className="text-[13px] whitespace-nowrap">{tx('Yalnızca zorunlu')}</span>
            </label>
          }
          rowActions={
            can('learning:enroll')
              ? [
                  {
                    label: tx('Bu eğitime kaydol'),
                    onSelect: (c) => setEnrollFor({ id: c.id, title: c.title }),
                  },
                ]
              : undefined
          }
        />
      )}

      {tab === 'sertifikalar' && (
        <DataTable
          rows={certifications.data}
          rowKey={(c) => c.id}
          columns={certColumns}
          isLoading={certifications.isPending}
          error={certifications.error}
          onRetry={() => void certifications.refetch()}
          searchPlaceholder={tx('Sertifika, kurum, belge no veya çalışan')}
          exportFileName="sertifikalar"
          emptyTitle={tx('Sertifika kaydı yok')}
          emptyDetail={tx('Çalışanların aldığı sertifikaları buraya ekleyin.')}
          emptyAction={
            <Button size="sm" className="cursor-pointer" onClick={() => setCertModal(true)}>
              {tx('Sertifika ekle')}
            </Button>
          }
        />
      )}

      {tab === 'suresi-dolan' && (
        <Panel>
          <PanelHead
            title={tx('Süresi dolan sertifikalar')}
            note={tx('Önümüzdeki 90 gün ve süresi geçmiş olanlar')}
          />
          {expiring.isPending ? (
            <RowsSkeleton rows={3} columns={2} />
          ) : expiring.isError ? (
            <ErrorState
              message={expiring.error instanceof Error ? expiring.error.message : undefined}
              onRetry={() => void expiring.refetch()}
            />
          ) : (expiring.data?.length ?? 0) === 0 ? (
            <EmptyState
              title={tx('Yaklaşan bitiş yok')}
              detail={tx('Önümüzdeki 90 gün içinde süresi dolacak sertifika bulunmuyor.')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {[...expiring.data!]
                .sort((a, b) => (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0))
                .map((c) => (
                  <ExpiringRow key={c.id} cert={c} />
                ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'uyum' && (
        <Panel>
          <PanelHead title={tx('Zorunlu eğitim uyumu')} note={tx('Her eğitim için tamamlama oranı')} />
          {compliance.isPending ? (
            <RowsSkeleton rows={3} columns={2} />
          ) : compliance.isError ? (
            <ErrorState
              message={compliance.error instanceof Error ? compliance.error.message : undefined}
              onRetry={() => void compliance.refetch()}
            />
          ) : (compliance.data?.length ?? 0) === 0 ? (
            <EmptyState
              title={tx('Zorunlu eğitim yok')}
              detail={tx('Zorunlu işaretlenmiş bir eğitim olmadığı için takip edilecek uyum da yok.')}
            />
          ) : (
            <PanelBody>
              <ul className="space-y-4">
                {compliance.data!.map((row) => (
                  <li key={row.courseId}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="text-[14px] font-medium">{row.courseTitle}</span>
                      <span className="tabular text-[12px] text-muted-foreground">
                        {tx('{0}/{1} kişi, %{2}', [formatNumber(row.completedCount), formatNumber(row.requiredCount), Math.round(row.compliancePercent)])}
                      </span>
                    </div>
                    <div className="mt-2">
                      <ProgressBar
                        value={row.completedCount}
                        max={row.requiredCount || 1}
                        tone={
                          row.compliancePercent >= 90
                            ? 'success'
                            : row.compliancePercent >= 60
                              ? 'warning'
                              : 'danger'
                        }
                        label={tx('{0} uyum oranı', [row.courseTitle])}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </PanelBody>
          )}
        </Panel>
      )}

      <NewCourseModal open={courseModal} onClose={() => setCourseModal(false)} />
      <NewCertificationModal open={certModal} onClose={() => setCertModal(false)} />
      <EnrollModal
        courseId={enrollFor?.id ?? null}
        courseTitle={enrollFor?.title ?? ''}
        onClose={() => setEnrollFor(null)}
      />
    </div>
  )
}
