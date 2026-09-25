import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable'
import { ClaimStatusBadge } from '@/components/ui/ModuleBadges'
import { EmployeePicker } from '@/components/ui/EmployeePicker'
import { InfoNote } from '@/components/ui/States'
import { useAuth } from '@/auth/useAuth'
import { useExpenseClaims } from '@/api/queries'
import { claimStatusLabels, type ClaimStatus, type ExpenseClaim } from '@/api/types'
import { formatDate, formatMoney, formatNumber } from '@/lib/format'
import { useEmployeeName } from '@/lib/useEmployeeName'
import { NewClaimModal } from './NewClaimModal'

const ALL = '__all__'

export function ExpensePage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const [employeeId, setEmployeeId] = useState('')
  const [status, setStatus] = useState<string>(ALL)
  const [modalOpen, setModalOpen] = useState(false)
  const nameOf = useEmployeeName()

  const claims = useExpenseClaims({
    employeeId: employeeId || undefined,
    status: status === ALL ? undefined : (status as ClaimStatus),
  })

  const filters: TableFilter[] = [
    {
      id: 'status',
      label: 'Durum',
      value: status,
      onChange: setStatus,
      options: [
        { value: ALL, label: 'Tüm durumlar' },
        ...(Object.keys(claimStatusLabels) as ClaimStatus[]).map((s) => ({
          value: s,
          label: claimStatusLabels[s],
        })),
      ],
    },
  ]

  const columns: Array<Column<ExpenseClaim>> = [
    {
      id: 'title',
      header: 'Başlık',
      searchText: (c) => c.title,
      sortValue: (c) => c.title,
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{c.title}</p>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {c.items?.length ? `${formatNumber(c.items.length)} kalem` : 'kalem yok'}
          </p>
        </div>
      ),
    },
    {
      id: 'employee',
      header: 'Çalışan',
      hideBelow: 'md',
      searchText: (c) => nameOf(c.employeeId),
      sortValue: (c) => nameOf(c.employeeId),
      exportText: (c) => nameOf(c.employeeId),
      cell: (c) => <span className="text-muted-foreground">{nameOf(c.employeeId)}</span>,
    },
    {
      id: 'createdAt',
      header: 'Tarih',
      hideBelow: 'lg',
      sortValue: (c) => new Date(c.createdAt).getTime(),
      exportText: (c) => formatDate(c.createdAt),
      cell: (c) => <span className="tabular text-muted-foreground">{formatDate(c.createdAt)}</span>,
    },
    {
      id: 'amount',
      header: 'Tutar',
      align: 'right',
      sortValue: (c) => c.totalAmount,
      exportText: (c) => formatMoney(c.totalAmount, c.currency),
      cell: (c) => (
        <span className="font-semibold">{formatMoney(c.totalAmount, c.currency)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (c) => claimStatusLabels[c.status] ?? '',
      exportText: (c) => claimStatusLabels[c.status] ?? '',
      cell: (c) => <ClaimStatusBadge status={c.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Masraf"
        description="Masraf talepleri ve durumları."
        actions={
          can('expense:create') && (
            <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
              <Plus className="size-4" />
              Yeni talep
            </Button>
          )
        }
      />

      <div className="max-w-sm">
        <EmployeePicker
          id="claim-filter-employee"
          value={employeeId}
          onChange={setEmployeeId}
          label="Çalışan"
          hint="Boş bırakılırsa tüm çalışanlar listelenir."
        />
      </div>

      <DataTable
        rows={claims.data}
        rowKey={(c) => c.id}
        columns={columns}
        filters={filters}
        isLoading={claims.isPending}
        error={claims.error}
        onRetry={() => void claims.refetch()}
        onRowClick={(c) => navigate(`/panel/masraf/${c.id}`)}
        searchPlaceholder="Başlık veya çalışan ara"
        exportFileName="masraf-talepleri"
        initialSort={{ columnId: 'createdAt', dir: 'desc' }}
        emptyTitle="Masraf talebi yok"
        emptyDetail="Bu filtreye uyan talep bulunmuyor."
        emptyAction={
          can('expense:create') ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              Yeni talep
            </Button>
          ) : undefined
        }
        notice={
          <InfoNote>
            Onay akışı <em>Onay kutusu</em> üzerinden yürür; onaylanan talebin durumu buraya
            kendiliğinden yansır. Bu ekranda karar verilmez.
          </InfoNote>
        }
      />

      <NewClaimModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}
