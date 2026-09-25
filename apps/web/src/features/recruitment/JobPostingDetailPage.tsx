import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { CenteredSpinner, EmptyState, ErrorState } from '@/components/ui/States'
import {
  ApplicationStatusBadge,
  InterviewResultBadge,
  JobPostingStatusBadge,
} from '@/components/ui/ModuleBadges'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { recruitmentApi } from '@/api/recruitment'
import { useCandidates, useEmployees, useJobPosting } from '@/api/queries'
import {
  applicationStatusLabels,
  employmentTypeLabels,
  interviewTypeLabels,
  type Application,
  type ApplicationStatus,
  type InterviewType,
} from '@/api/types'
import { formatDate, formatDateTime, formatNumber, fullName } from '@/lib/format'
import { ApplicationFunnel } from './ApplicationFunnel'

/** Başvuru durumunu ilerletme — sıradaki mantıklı aşamayı önerir. */
const NEXT_STAGE: Partial<Record<ApplicationStatus, ApplicationStatus>> = {
  Applied: 'Screening',
  Screening: 'Interview',
  Interview: 'Offer',
  Offer: 'Hired',
}

function StatusModal({
  state,
  onClose,
}: {
  state: { application: Application; suggested?: ApplicationStatus } | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ApplicationStatus>('Screening')
  const [notes, setNotes] = useState('')

  // Modal her açılışta önerilen aşamayla başlasın.
  useEffect(() => {
    if (state) {
      setStatus(state.suggested ?? NEXT_STAGE[state.application.status] ?? state.application.status)
      setNotes('')
    }
  }, [state])

  const mutation = useMutation({
    mutationFn: () =>
      recruitmentApi.setApplicationStatus(state!.application.id, status, notes.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      toast.ok('Başvuru durumu güncellendi')
      onClose()
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Durum güncellenemedi.'),
  })

  if (!state) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="Başvuru durumu"
      note="Aday hangi aşamaya geçiyor?"
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Vazgeç
          </Button>
          <Button
            className="cursor-pointer"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Güncelle
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          id="app-status"
          label="Yeni durum"
          value={status}
          onChange={(v) => setStatus(v as ApplicationStatus)}
          options={(Object.keys(applicationStatusLabels) as ApplicationStatus[]).map((s) => ({
            value: s,
            label: applicationStatusLabels[s],
          }))}
        />
        <TextAreaField
          id="app-notes"
          label="Not"
          rows={3}
          value={notes}
          maxLength={1000}
          hint="İsteğe bağlı. Başvuru geçmişinde görünür."
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  )
}

function InterviewModal({
  application,
  onClose,
}: {
  application: Application | null
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const employees = useEmployees()
  const [type, setType] = useState<InterviewType>('Phone')
  const [scheduledAt, setScheduledAt] = useState('')
  const [interviewerEmployeeId, setInterviewer] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      recruitmentApi.scheduleInterview(application!.id, {
        type,
        scheduledAt,
        interviewerEmployeeId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      toast.ok('Mülakat planlandı')
      onClose()
      setScheduledAt('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Mülakat planlanamadı.'),
  })

  if (!application) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!scheduledAt) return setError('Tarih ve saat zorunlu.')
    if (!interviewerEmployeeId) return setError('Görüşmeci seçilmeli.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Mülakat planla"
      note="Görüşmeciye takvim daveti backend tarafında oluşturulur."
      footer={
        <>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Vazgeç
          </Button>
          <Button
            type="submit"
            form="new-interview"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Planla
          </Button>
        </>
      }
    >
      <form id="new-interview" onSubmit={submit} noValidate className="space-y-4">
        <SelectField
          id="interview-type"
          label="Mülakat türü"
          value={type}
          onChange={(v) => setType(v as InterviewType)}
          options={(Object.keys(interviewTypeLabels) as InterviewType[]).map((t) => ({
            value: t,
            label: interviewTypeLabels[t],
          }))}
        />

        <TextField
          id="interview-at"
          label="Tarih ve saat"
          type="datetime-local"
          required
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          error={error?.includes('Tarih') ? error : undefined}
        />

        <SelectField
          id="interview-by"
          label="Görüşmeci"
          required
          value={interviewerEmployeeId}
          onChange={setInterviewer}
          options={(employees.data ?? []).map((e) => ({ value: e.id, label: fullName(e) }))}
          placeholder="Çalışan seçin"
          error={error?.includes('Görüşmeci') ? error : undefined}
        />
      </form>
    </Modal>
  )
}

export function JobPostingDetailPage() {
  const { postingId } = useParams<{ postingId: string }>()
  const { can } = useAuth()
  const toast = useToast()
  const queryClient = useQueryClient()
  const posting = useJobPosting(postingId)
  const candidates = useCandidates(undefined, can('recruitment:candidates'))

  const [statusFor, setStatusFor] = useState<{
    application: Application
    suggested?: ApplicationStatus
  } | null>(null)
  const [interviewFor, setInterviewFor] = useState<Application | null>(null)

  const candidateName = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of candidates.data ?? []) map.set(c.id, `${c.firstName} ${c.lastName}`)
    return map
  }, [candidates.data])

  const publish = useMutation({
    mutationFn: () => recruitmentApi.publishPosting(postingId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      toast.ok('İlan yayına alındı')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'İlan yayınlanamadı.'),
  })

  const close = useMutation({
    mutationFn: () => recruitmentApi.closePosting(postingId!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      toast.ok('İlan kapatıldı')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'İlan kapatılamadı.'),
  })

  if (posting.isPending) return <CenteredSpinner label="İlan yükleniyor" />

  if (posting.isError || !posting.data) {
    return (
      <Panel>
        <ErrorState
          title="İlan bulunamadı"
          message={posting.error instanceof Error ? posting.error.message : undefined}
          onRetry={() => void posting.refetch()}
        />
      </Panel>
    )
  }

  const data = posting.data
  const applications = data.applications ?? []
  const canManage = can('recruitment:candidates')
  const canPublish = can('recruitment:publish')

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/ise-alim">
          <ArrowLeft className="size-4" />
          İşe alım
        </Link>
      </Button>

      <PageHeader
        title={data.title}
        description={`${employmentTypeLabels[data.employmentType]}, ${formatNumber(data.headcount)} kişi. ${formatNumber(applications.length)} başvuru.`}
        actions={
          <>
            <JobPostingStatusBadge status={data.status} />
            {canPublish && data.status === 'Draft' && (
              <Button
                className="cursor-pointer"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending && <LoaderCircle className="size-4 animate-spin" />}
                Yayına al
              </Button>
            )}
            {canPublish && data.status === 'Published' && (
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={close.isPending}
                onClick={() => close.mutate()}
              >
                {close.isPending && <LoaderCircle className="size-4 animate-spin" />}
                İlanı kapat
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.15fr]">
        <Panel>
          <PanelHead title="Başvuru hunisi" note="Aşamalar arası geçiş oranıyla" />
          <PanelBody>
            {applications.length === 0 ? (
              <EmptyState
                title="Henüz başvuru yok"
                detail="İlan yayına alındığında başvurular burada aşamalarına göre görünür."
              />
            ) : (
              <ApplicationFunnel applications={applications} />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHead
            title="Başvurular"
            action={
              <span className="tabular text-[12px] text-muted-foreground">
                {formatNumber(applications.length)} kayıt
              </span>
            }
          />
          {applications.length === 0 ? (
            <EmptyState title="Başvuru yok" detail="Aday eklendikçe bu listede görünür." />
          ) : (
            <ul className="divide-y divide-border">
              {applications.map((a) => {
                const next = NEXT_STAGE[a.status]
                return (
                  <li key={a.id} className="px-4 py-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                      <span className="min-w-0">
                        <span className="block truncate text-[14px] font-medium">
                          {candidateName.get(a.candidateId) ?? `${a.candidateId.slice(0, 8)}…`}
                        </span>
                        <span className="tabular mt-0.5 block text-[12px] text-muted-foreground">
                          {formatDate(a.appliedAt)} tarihinde başvurdu
                        </span>
                      </span>
                      <ApplicationStatusBadge status={a.status} />
                    </div>

                    {a.notes && (
                      <p className="mt-1.5 border-l-2 border-border pl-3 text-[13px] leading-relaxed text-muted-foreground">
                        {a.notes}
                      </p>
                    )}

                    {(a.interviews?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-1">
                        {a.interviews!.map((iv) => (
                          <li
                            key={iv.id}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px]"
                          >
                            <span className="text-muted-foreground">
                              {interviewTypeLabels[iv.type]}
                            </span>
                            <span className="tabular">{formatDateTime(iv.scheduledAt)}</span>
                            <InterviewResultBadge result={iv.result} />
                          </li>
                        ))}
                      </ul>
                    )}

                    {canManage && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {next && (
                          <Button
                            size="sm"
                            className="cursor-pointer"
                            onClick={() => setStatusFor({ application: a, suggested: next })}
                          >
                            {applicationStatusLabels[next]} aşamasına al
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="cursor-pointer"
                          onClick={() => setStatusFor({ application: a })}
                        >
                          Durum değiştir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="cursor-pointer"
                          onClick={() => setInterviewFor(a)}
                        >
                          Mülakat planla
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      {data.description && (
        <Panel>
          <PanelHead title="İlan metni" />
          <PanelBody>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {data.description}
            </p>
          </PanelBody>
        </Panel>
      )}

      <StatusModal state={statusFor} onClose={() => setStatusFor(null)} />
      <InterviewModal application={interviewFor} onClose={() => setInterviewFor(null)} />
    </div>
  )
}
