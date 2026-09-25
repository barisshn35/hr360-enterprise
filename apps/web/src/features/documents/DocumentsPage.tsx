import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Modal } from '@/components/ui/Modal'
import { TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { InfoNote } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { expenseApi } from '@/api/expense'
import { useDocuments } from '@/api/queries'
import type { HrDocument } from '@/api/types'
import { formatDateTime } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'

function NewDocumentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [storageKey, setStorageKey] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      expenseApi.createDocument({
        employeeId,
        type: type.trim(),
        name: name.trim(),
        storageKey: storageKey.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      toast.ok('Doküman kaydedildi')
      onClose()
      setType('')
      setName('')
      setStorageKey('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Doküman kaydedilemedi.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) return setError('Çalışan seçilmeli.')
    if (!type.trim()) return setError('Doküman türü zorunlu.')
    if (name.trim().length < 3) return setError('Doküman adı en az 3 karakter olmalı.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni doküman kaydı"
      note="Dosya yükleme backend'de henüz yok; burada yalnızca kayıt tutulur."
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
            form="new-doc"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Kaydet
          </Button>
        </>
      }
    >
      <form id="new-doc" onSubmit={submit} noValidate className="space-y-4">
        <EmployeePicker
          id="doc-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint={error?.includes('Çalışan') ? error : undefined}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="doc-type"
            label="Tür"
            required
            hint="Örn. Sözleşme, Bordro, Kimlik"
            value={type}
            onChange={(e) => setType(e.target.value)}
            error={error?.includes('türü') ? error : undefined}
          />
          <TextField
            id="doc-name"
            label="Doküman adı"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error?.includes('adı') ? error : undefined}
          />
        </div>
        <TextField
          id="doc-key"
          label="Depolama anahtarı"
          hint="İsteğe bağlı; dosya deposundaki karşılığı"
          value={storageKey}
          onChange={(e) => setStorageKey(e.target.value)}
        />
      </form>
    </Modal>
  )
}

function DeleteConfirm({ doc, onClose }: { doc: HrDocument | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => expenseApi.deleteDocument(doc!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expense'] })
      toast.ok('Doküman kaydı silindi')
      onClose()
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Kayıt silinemedi.'),
  })

  if (!doc) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="Doküman kaydını sil"
      note={doc.name}
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
            variant="destructive"
            className="cursor-pointer"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Sil
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        Bu kayıt kalıcı olarak silinir ve geri alınamaz. Dosyanın kendisi varsa depoda kalmaya
        devam eder.
      </p>
    </Modal>
  )
}

export function DocumentsPage() {
  const [employeeId, setEmployeeId] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [toDelete, setToDelete] = useState<HrDocument | null>(null)
  const nameOf = useEmployeeName()

  const documents = useDocuments({ employeeId: employeeId || undefined })

  const columns: Array<Column<HrDocument>> = [
    {
      id: 'name',
      header: 'Doküman',
      searchText: (d) => `${d.name} ${d.type} ${d.storageKey ?? ''}`,
      sortValue: (d) => d.name,
      cell: (d) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{d.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {d.storageKey ?? 'dosya bağlı değil'}
          </p>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Tür',
      hideBelow: 'sm',
      sortValue: (d) => d.type,
      exportText: (d) => d.type,
      cell: (d) => <StatusBadge tone="neutral">{d.type}</StatusBadge>,
    },
    {
      id: 'employee',
      header: 'Çalışan',
      hideBelow: 'md',
      searchText: (d) => nameOf(d.employeeId),
      sortValue: (d) => nameOf(d.employeeId),
      exportText: (d) => nameOf(d.employeeId),
      cell: (d) => <span className="text-muted-foreground">{nameOf(d.employeeId)}</span>,
    },
    {
      id: 'createdAt',
      header: 'Kayıt',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (d) => new Date(d.createdAt).getTime(),
      exportText: (d) => formatDateTime(d.createdAt),
      cell: (d) => (
        <span className="tabular text-muted-foreground">{formatDateTime(d.createdAt)}</span>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dokümanlar"
        description="Çalışan dosyalarına bağlı doküman kayıtları. Bu sayfa yalnızca İK yönetimine açıktır."
        actions={
          <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
            <Plus className="size-4" />
            Yeni kayıt
          </Button>
        }
      />

      <div className="max-w-sm">
        <EmployeePicker
          id="doc-filter-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint="Boş bırakılırsa tüm çalışanlar listelenir."
        />
      </div>

      <DataTable
        rows={documents.data}
        rowKey={(d) => d.id}
        columns={columns}
        isLoading={documents.isPending}
        error={documents.error}
        onRetry={() => void documents.refetch()}
        searchPlaceholder="Doküman adı, tür veya çalışan"
        exportFileName="dokuman-kayitlari"
        pageSize={12}
        initialSort={{ columnId: 'createdAt', dir: 'desc' }}
        emptyTitle="Doküman kaydı yok"
        emptyDetail="Bu filtreye uyan kayıt bulunmuyor."
        emptyAction={
          <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
            Yeni kayıt
          </Button>
        }
        rowActions={[
          { label: 'Kaydı sil', destructive: true, onSelect: (d) => setToDelete(d) },
        ]}
        notice={
          <InfoNote>
            Bu ekran dosyanın kendisini tutmaz — yalnızca hangi çalışanda hangi belgenin
            bulunduğunu kayda geçirir. Dosya yükleme ucu backend'e eklendiğinde buraya bağlanır.
          </InfoNote>
        }
      />

      <NewDocumentModal open={modalOpen} onClose={() => setModalOpen(false)} />
      <DeleteConfirm doc={toDelete} onClose={() => setToDelete(null)} />
    </div>
  )
}
