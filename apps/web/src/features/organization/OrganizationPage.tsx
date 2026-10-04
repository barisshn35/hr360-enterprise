import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { useAuth } from '@/auth/useAuth'
import { useCompanies } from '@/api/queries'
import type { Company } from '@/api/types'
import { formatDate, formatNumber } from '@/lib/format'
import { NewCompanyModal } from './NewCompanyModal'
import { tx } from '@/lib/i18n'

export function OrganizationPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const companies = useCompanies()
  const [modalOpen, setModalOpen] = useState(false)

  const canCreate = can('organization:manage')

  const columns: Array<Column<Company>> = [
    {
      id: 'name',
      header: tx('Şirket'),
      searchText: (c) => `${c.name} ${c.taxNumber ?? ''}`.trim(),
      // CSV'de arama metni (ad + boş vergi no → sonda boşluk) değil yalnızca ad yazılır.
      exportText: (c) => c.name.trim(),
      sortValue: (c) => c.name,
      cell: (c) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Building2 className="size-4 text-primary" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{c.name}</p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {c.taxNumber ? tx('Vergi no {0}', [c.taxNumber]) : tx('Vergi numarası girilmemiş')}
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'departments',
      header: tx('Departman'),
      align: 'right',
      hideBelow: 'sm',
      sortValue: (c) => c.departments?.length ?? 0,
      exportText: (c) => String(c.departments?.length ?? 0),
      cell: (c) => formatNumber(c.departments?.length ?? 0),
    },
    {
      id: 'createdAt',
      header: tx('Oluşturulma'),
      align: 'right',
      hideBelow: 'md',
      sortValue: (c) => new Date(c.createdAt).getTime(),
      exportText: (c) => formatDate(c.createdAt),
      cell: (c) => <span className="text-muted-foreground">{formatDate(c.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title={tx('Organizasyon')}
        description={tx('Şirketler ve altlarındaki departman hiyerarşisi.')}
        actions={
          canCreate && (
            <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
              <Plus className="size-4" />
              {tx('Yeni şirket')}
            </Button>
          )
        }
      />

      <DataTable
        rows={companies.data}
        rowKey={(c) => c.id}
        columns={columns}
        isLoading={companies.isPending}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        onRowClick={(c) => navigate(`/panel/organizasyon/${c.id}`)}
        searchPlaceholder={tx('Şirket adı veya vergi numarası')}
        exportFileName="sirketler"
        initialSort={{ columnId: 'name', dir: 'asc' }}
        emptyTitle={tx('Şirket kaydı yok')}
        emptyDetail={tx('İlk şirketi ekleyin; departmanlar onun altına bağlanır.')}
        emptyAction={
          canCreate ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              {tx('Yeni şirket')}
            </Button>
          ) : undefined
        }
      />

      <NewCompanyModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
