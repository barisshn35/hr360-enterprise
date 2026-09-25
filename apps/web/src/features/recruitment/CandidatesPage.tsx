import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { ApplicationStatusBadge } from '@/components/ui/ModuleBadges'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { recruitmentApi } from '@/api/recruitment'
import { useCandidates } from '@/api/queries'
import type { Candidate } from '@/api/types'
import { formatDate, formatNumber } from '@/lib/format'

function NewCandidateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      recruitmentApi.createCandidate({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        source: source.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment'] })
      toast.ok('Aday kaydedildi')
      onClose()
      setFirstName('')
      setLastName('')
      setEmail('')
      setPhone('')
      setSource('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Aday kaydedilemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (firstName.trim().length < 2 || lastName.trim().length < 2)
      return setError('Ad ve soyad en az 2 karakter olmalı.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
      return setError('Geçerli bir e-posta adresi girin.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni aday"
      note="Aday havuzuna eklenir; başvuruyu ilan sayfasından bağlarsınız."
      size="lg"
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
            form="new-candidate"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Adayı kaydet
          </Button>
        </>
      }
    >
      <form id="new-candidate" onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="cand-first"
            label="Ad"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={error?.includes('Ad ve soyad') ? error : undefined}
          />
          <TextField
            id="cand-last"
            label="Soyad"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>

        <TextField
          id="cand-email"
          label="E-posta"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error?.includes('e-posta') ? error : undefined}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="cand-phone"
            label="Telefon"
            type="tel"
            hint="İsteğe bağlı"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField
            id="cand-source"
            label="Kaynak"
            hint="Örn. LinkedIn, referans"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  )
}

export function CandidatesPage() {
  const { can } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  // Arama DataTable içinde istemci tarafında yapılıyor; havuzun tamamı çekilir.
  const candidates = useCandidates(undefined)

  const canManage = can('recruitment:candidates')

  const columns: Array<Column<Candidate>> = [
    {
      id: 'name',
      header: 'Aday',
      searchText: (c) => `${c.firstName} ${c.lastName} ${c.email}`,
      sortValue: (c) => `${c.firstName} ${c.lastName}`,
      exportText: (c) => `${c.firstName} ${c.lastName}`,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {c.firstName} {c.lastName}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{c.email}</p>
        </div>
      ),
    },
    {
      id: 'phone',
      header: 'Telefon',
      hideBelow: 'lg',
      searchText: (c) => c.phone ?? '',
      exportText: (c) => c.phone ?? '—',
      cell: (c) => <span className="tabular text-muted-foreground">{c.phone ?? '—'}</span>,
    },
    {
      id: 'source',
      header: 'Kaynak',
      hideBelow: 'md',
      searchText: (c) => c.source ?? '',
      sortValue: (c) => c.source ?? '',
      exportText: (c) => c.source ?? '—',
      cell: (c) => <span className="text-muted-foreground">{c.source ?? '—'}</span>,
    },
    {
      id: 'applications',
      header: 'Başvuru',
      sortValue: (c) => c.applications?.length ?? 0,
      exportText: (c) => String(c.applications?.length ?? 0),
      cell: (c) =>
        (c.applications?.length ?? 0) === 0 ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {c.applications!.slice(0, 3).map((a) => (
              <ApplicationStatusBadge key={a.id} status={a.status} />
            ))}
            {c.applications!.length > 3 && (
              <span className="tabular text-[12px] text-muted-foreground">
                +{c.applications!.length - 3}
              </span>
            )}
          </div>
        ),
    },
    {
      id: 'createdAt',
      header: 'Kayıt',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (c) => new Date(c.createdAt).getTime(),
      exportText: (c) => formatDate(c.createdAt),
      cell: (c) => <span className="text-muted-foreground">{formatDate(c.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" className="-ml-2 cursor-pointer" asChild>
        <Link to="/panel/ise-alim">
          <ArrowLeft className="size-4" />
          İşe alım
        </Link>
      </Button>

      <PageHeader
        title="Adaylar"
        description={`Aday havuzu ve başvuru geçmişleri.${
          candidates.data ? ` ${formatNumber(candidates.data.length)} kayıt.` : ''
        }`}
        actions={
          canManage && (
            <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
              <Plus className="size-4" />
              Yeni aday
            </Button>
          )
        }
      />

      <DataTable
        rows={candidates.data}
        rowKey={(c) => c.id}
        columns={columns}
        isLoading={candidates.isPending}
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
        searchPlaceholder="Ad, soyad, e-posta veya kaynak"
        exportFileName="adaylar"
        pageSize={12}
        initialSort={{ columnId: 'createdAt', dir: 'desc' }}
        emptyTitle="Aday kaydı yok"
        emptyDetail="İlk adayı ekleyerek havuzu oluşturmaya başlayın."
        emptyAction={
          canManage ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              Yeni aday
            </Button>
          ) : undefined
        }
      />

      <NewCandidateModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
