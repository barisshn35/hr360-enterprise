import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { AssetStatusBadge } from '@/components/ui/ModuleBadges'
import { Tabs, useTabParam, type TabDef } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { onboardingApi } from '@/api/onboarding'
import { useAssets, useEmployees } from '@/api/queries'
import {
  assetStatusLabels,
  assetTypeLabels,
  type Asset,
  type AssetStatus,
  type AssetType,
} from '@/api/types'
import { formatDate, fullName } from '@/lib/format'
import { localISODate } from '@/lib/dates'

type TabKey = AssetStatus | 'all'

const TABS: Array<TabDef<TabKey>> = [
  { key: 'all', label: 'Tümü' },
  { key: 'Available', label: 'Boşta' },
  { key: 'Assigned', label: 'Zimmetli' },
  { key: 'Maintenance', label: 'Bakımda' },
  { key: 'Retired', label: 'Hurda' },
  { key: 'Lost', label: 'Kayıp' },
]

function NewAssetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [assetTag, setAssetTag] = useState('')
  const [type, setType] = useState<AssetType>('Laptop')
  const [model, setModel] = useState('')
  const [serialNumber, setSerial] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      onboardingApi.createAsset({
        assetTag: assetTag.trim(),
        type,
        model: model.trim() || undefined,
        serialNumber: serialNumber.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      toast.ok('Zimmet kaydı oluşturuldu')
      onClose()
      setAssetTag('')
      setModel('')
      setSerial('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Kayıt oluşturulamadı.'),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (assetTag.trim().length < 2) return setError('Demirbaş no en az 2 karakter olmalı.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Yeni demirbaş"
      note="Kayıt boşta olarak açılır; zimmetlemek ayrı bir adım."
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
            form="new-asset"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Kaydet
          </Button>
        </>
      }
    >
      <form id="new-asset" onSubmit={submit} noValidate className="space-y-4">
        <TextField
          id="asset-tag"
          label="Demirbaş no"
          required
          value={assetTag}
          onChange={(e) => setAssetTag(e.target.value)}
          error={error}
        />
        <SelectField
          id="asset-type"
          label="Tür"
          value={type}
          onChange={(v) => setType(v as AssetType)}
          options={(Object.keys(assetTypeLabels) as AssetType[]).map((t) => ({
            value: t,
            label: assetTypeLabels[t],
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="asset-model"
            label="Model"
            hint="İsteğe bağlı"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <TextField
            id="asset-serial"
            label="Seri no"
            hint="İsteğe bağlı"
            className="tabular"
            value={serialNumber}
            onChange={(e) => setSerial(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  )
}

function AssignModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [employeeId, setEmployeeId] = useState('')
  const [assignedOn, setAssignedOn] = useState(localISODate())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | undefined>()

  const mutation = useMutation({
    mutationFn: () =>
      onboardingApi.assignAsset(asset!.id, {
        employeeId,
        assignedOn,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      toast.ok('Zimmet atandı')
      onClose()
      setEmployeeId('')
      setNotes('')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Zimmet atanamadı.'),
  })

  if (!asset) return null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!employeeId) return setError('Çalışan seçilmeli.')
    setError(undefined)
    mutation.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Zimmet ata"
      note={`${asset.assetTag}, ${assetTypeLabels[asset.type]}`}
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
            form="assign-asset"
            className="cursor-pointer"
            disabled={mutation.isPending}
          >
            {mutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
            Ata
          </Button>
        </>
      }
    >
      <form id="assign-asset" onSubmit={submit} noValidate className="space-y-4">
        <EmployeePicker
          id="assign-employee"
          value={employeeId}
          onChange={setEmployeeId}
          hint={error}
        />
        <TextField
          id="assign-date"
          label="Zimmet tarihi"
          type="date"
          required
          value={assignedOn}
          onChange={(e) => setAssignedOn(e.target.value)}
        />
        <TextAreaField
          id="assign-notes"
          label="Not"
          rows={2}
          hint="İsteğe bağlı"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </form>
    </Modal>
  )
}

function ReturnModal({ asset, onClose }: { asset: Asset | null; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [returnedOn, setReturnedOn] = useState(localISODate())
  const [condition, setCondition] = useState('')
  const [markAsRetired, setRetired] = useState(false)

  const mutation = useMutation({
    mutationFn: () =>
      onboardingApi.returnAsset(asset!.id, {
        returnedOn,
        condition: condition.trim() || undefined,
        markAsRetired,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      toast.ok(markAsRetired ? 'İade alındı, hurdaya ayrıldı' : 'İade alındı')
      onClose()
      setCondition('')
      setRetired(false)
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'İade kaydedilemedi.'),
  })

  if (!asset) return null

  return (
    <Modal
      open
      onClose={onClose}
      title="İade al"
      note={`${asset.assetTag}, ${assetTypeLabels[asset.type]}`}
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
            İadeyi kaydet
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          id="return-date"
          label="İade tarihi"
          type="date"
          required
          value={returnedOn}
          onChange={(e) => setReturnedOn(e.target.value)}
        />
        <TextField
          id="return-condition"
          label="Durum"
          hint="İsteğe bağlı. Örn. çizik var, kutusu eksik."
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
        />
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={markAsRetired}
            onCheckedChange={(v) => setRetired(v === true)}
            className="mt-0.5"
          />
          <span className="text-[13px]">
            Hurdaya ayır
            <span className="block text-[12px] text-muted-foreground">
              İşaretlenmezse demirbaş yeniden boşta görünür.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  )
}

export function AssetsPage() {
  const { can } = useAuth()
  const [tab, setTab] = useTabParam<TabKey>('durum', 'all')
  const [newOpen, setNewOpen] = useState(false)
  const [assignFor, setAssignFor] = useState<Asset | null>(null)
  const [returnFor, setReturnFor] = useState<Asset | null>(null)

  const assets = useAssets({ status: tab === 'all' ? undefined : tab })
  const employees = useEmployees({ enabled: can('employee:viewAll') })

  const canManage = can('asset:manage')

  const nameOf = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of employees.data ?? []) map.set(e.id, fullName(e))
    return (id: string) => map.get(id) ?? `${id.slice(0, 8)}…`
  }, [employees.data])

  const columns: Array<Column<Asset>> = [
    {
      id: 'tag',
      header: 'Demirbaş',
      searchText: (a) => `${a.assetTag} ${assetTypeLabels[a.type]} ${a.model ?? ''}`,
      sortValue: (a) => a.assetTag,
      exportText: (a) => a.assetTag,
      cell: (a) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{a.assetTag}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {assetTypeLabels[a.type]}
            {a.model ? `, ${a.model}` : ''}
          </p>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Tür',
      hideBelow: 'lg',
      sortValue: (a) => assetTypeLabels[a.type] ?? '',
      exportText: (a) => assetTypeLabels[a.type] ?? '',
      cell: (a) => <span className="text-muted-foreground">{assetTypeLabels[a.type]}</span>,
    },
    {
      id: 'serial',
      header: 'Seri no',
      hideBelow: 'lg',
      searchText: (a) => a.serialNumber ?? '',
      exportText: (a) => a.serialNumber ?? '—',
      cell: (a) => <span className="tabular text-muted-foreground">{a.serialNumber ?? '—'}</span>,
    },
    {
      id: 'holder',
      header: 'Zimmetli',
      hideBelow: 'md',
      searchText: (a) => (a.assignedEmployeeId ? nameOf(a.assignedEmployeeId) : ''),
      sortValue: (a) => (a.assignedEmployeeId ? nameOf(a.assignedEmployeeId) : ''),
      exportText: (a) => (a.assignedEmployeeId ? nameOf(a.assignedEmployeeId) : '—'),
      cell: (a) =>
        a.assignedEmployeeId ? (
          <div className="min-w-0">
            <p className="truncate">{nameOf(a.assignedEmployeeId)}</p>
            {a.assignedOn && (
              <p className="tabular text-[12px] text-muted-foreground">
                {formatDate(a.assignedOn)}
              </p>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (a) => assetStatusLabels[a.status] ?? '',
      exportText: (a) => assetStatusLabels[a.status] ?? '',
      cell: (a) => <AssetStatusBadge status={a.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Zimmet"
        description="Demirbaş envanteri, atama ve iade kayıtları."
        actions={
          canManage && (
            <Button className="cursor-pointer" onClick={() => setNewOpen(true)}>
              <Plus className="size-4" />
              Yeni demirbaş
            </Button>
          )
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Zimmet durumu" />

      <DataTable
        rows={assets.data}
        rowKey={(a) => a.id}
        columns={columns}
        isLoading={assets.isPending}
        error={assets.error}
        onRetry={() => void assets.refetch()}
        searchPlaceholder="Demirbaş no, model, seri no veya kişi"
        exportFileName="zimmet-envanteri"
        pageSize={12}
        emptyTitle="Bu durumda demirbaş yok"
        emptyDetail="Başka bir durum sekmesi seçin ya da yeni bir demirbaş ekleyin."
        emptyAction={
          canManage ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setNewOpen(true)}>
              Yeni demirbaş
            </Button>
          ) : undefined
        }
        rowActions={
          canManage
            ? [
                {
                  label: 'Zimmet ata',
                  hidden: (a) => a.status !== 'Available',
                  onSelect: (a) => setAssignFor(a),
                },
                {
                  label: 'İade al',
                  hidden: (a) => a.status !== 'Assigned',
                  onSelect: (a) => setReturnFor(a),
                },
              ]
            : undefined
        }
      />

      <NewAssetModal open={newOpen} onClose={() => setNewOpen(false)} />
      <AssignModal asset={assignFor} onClose={() => setAssignFor(null)} />
      <ReturnModal asset={returnFor} onClose={() => setReturnFor(null)} />
    </div>
  )
}
