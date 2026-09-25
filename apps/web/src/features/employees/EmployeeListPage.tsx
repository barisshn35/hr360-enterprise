import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { DataTable, type Column, type TableFilter } from '@/components/ui/DataTable'
import { EmployeeStatusBadge } from '@/components/ui/ModuleBadges'
import { useAuth } from '@/auth/useAuth'
import { useCompanies, useEmployees } from '@/api/queries'
import {
  EmployeeStatus,
  employeeStatusLabels,
  type Employee,
  type EmployeeStatusValue,
} from '@/api/types'
import { formatDate, fullName, initialsOf } from '@/lib/format'
import { NewEmployeeModal } from './NewEmployeeModal'
import { ImportEmployeesModal } from './ImportEmployeesModal'

type StatusFilter = 'all' | `${EmployeeStatusValue}`

export function EmployeeListPage() {
  const { can } = useAuth()
  const navigate = useNavigate()
  const employees = useEmployees()
  const companies = useCompanies({ enabled: can('organization:view') })

  const [status, setStatus] = useState<StatusFilter>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)

  const canCreate = can('employee:manage') || can('employee:create')

  const departmentNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of companies.data ?? []) {
      for (const d of c.departments ?? []) map.set(d.id, d.name)
    }
    return map
  }, [companies.data])

  const departmentOptions = useMemo(
    () =>
      (companies.data ?? []).flatMap((c) =>
        (c.departments ?? []).map((d) => ({
          id: d.id,
          label: (companies.data?.length ?? 0) > 1 ? `${c.name} · ${d.name}` : d.name,
        })),
      ),
    [companies.data],
  )

  const rows = useMemo(
    () =>
      (employees.data ?? []).filter((e) => status === 'all' || String(e.status) === status),
    [employees.data, status],
  )

  const currentAssignment = (e: Employee) =>
    e.assignments?.find((a) => !a.effectiveTo) ?? e.assignments?.[0]

  const departmentOf = (e: Employee) => {
    const current = currentAssignment(e)
    if (!current) return 'Atanmamış'
    return departmentNames.get(current.departmentId) ?? 'Listede olmayan departman'
  }

  const filters: TableFilter[] = [
    {
      id: 'status',
      label: 'Durum',
      value: status,
      onChange: (v) => setStatus(v as StatusFilter),
      options: [
        { value: 'all', label: 'Tüm durumlar' },
        { value: String(EmployeeStatus.Active), label: employeeStatusLabels[0] },
        { value: String(EmployeeStatus.OnLeave), label: employeeStatusLabels[1] },
        { value: String(EmployeeStatus.Terminated), label: employeeStatusLabels[2] },
      ],
    },
  ]

  const columns: Array<Column<Employee>> = [
    {
      id: 'name',
      header: 'Çalışan',
      searchText: (e) => `${fullName(e)} ${e.email ?? ''}`,
      sortValue: (e) => fullName(e),
      exportText: (e) => fullName(e),
      cell: (e) => (
        <div className="flex items-center gap-3">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="bg-primary/10 text-[12px] font-semibold text-primary">
              {initialsOf(e.firstName, e.lastName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{fullName(e)}</p>
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{e.email}</p>
          </div>
        </div>
      ),
    },
    {
      id: 'department',
      header: 'Departman',
      hideBelow: 'md',
      searchText: (e) => departmentOf(e),
      sortValue: (e) => departmentOf(e),
      exportText: (e) => departmentOf(e),
      cell: (e) => {
        const current = currentAssignment(e)
        return (
          <div className="min-w-0">
            <p className="truncate">{departmentOf(e)}</p>
            {current?.positionTitle && (
              <p className="truncate text-[12px] text-muted-foreground">{current.positionTitle}</p>
            )}
          </div>
        )
      },
    },
    {
      id: 'position',
      header: 'Pozisyon',
      hideBelow: 'lg',
      searchText: (e) => currentAssignment(e)?.positionTitle ?? '',
      sortValue: (e) => currentAssignment(e)?.positionTitle ?? '',
      exportText: (e) => currentAssignment(e)?.positionTitle ?? '—',
      cell: (e) => (
        <span className="text-muted-foreground">
          {currentAssignment(e)?.positionTitle ?? '—'}
        </span>
      ),
    },
    {
      id: 'hireDate',
      header: 'İşe giriş',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (e) => new Date(e.hireDate).getTime(),
      exportText: (e) => formatDate(e.hireDate),
      cell: (e) => <span className="text-muted-foreground">{formatDate(e.hireDate)}</span>,
    },
    {
      id: 'status',
      header: 'Durum',
      align: 'right',
      sortValue: (e) => employeeStatusLabels[e.status] ?? '',
      exportText: (e) => employeeStatusLabels[e.status] ?? 'Bilinmiyor',
      cell: (e) => <EmployeeStatusBadge status={e.status} />,
    },
  ]

  return (
    <div className="space-y-5">
      <PageHeader
        title="Çalışanlar"
        description="Kayıtlar, departman atamaları ve çalışma durumu."
        actions={
          canCreate && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() => setImportModalOpen(true)}
              >
                <FileSpreadsheet className="size-4" />
                Excel'den içe aktar
              </Button>
              <Button className="cursor-pointer" onClick={() => setModalOpen(true)}>
                <Plus className="size-4" />
                Yeni çalışan
              </Button>
            </div>
          )
        }
      />

      <DataTable
        rows={rows}
        rowKey={(e) => e.id}
        columns={columns}
        filters={filters}
        isLoading={employees.isPending}
        error={employees.error}
        onRetry={() => void employees.refetch()}
        onRowClick={(e) => navigate(`/panel/calisanlar/${e.id}`)}
        searchPlaceholder="Ad, soyad, e-posta veya departman"
        exportFileName="calisanlar"
        pageSize={12}
        initialSort={{ columnId: 'name', dir: 'asc' }}
        emptyTitle={employees.data?.length === 0 ? 'Çalışan kaydı yok' : 'Filtreye uyan kayıt yok'}
        emptyDetail={
          employees.data?.length === 0
            ? 'İlk çalışanı ekleyin; atamasını kayıttan sonra yapabilirsiniz.'
            : 'Durum filtresini değiştirin ya da aramayı temizleyin.'
        }
        emptyAction={
          canCreate && employees.data?.length === 0 ? (
            <Button size="sm" className="cursor-pointer" onClick={() => setModalOpen(true)}>
              Yeni çalışan
            </Button>
          ) : undefined
        }
      />

      <NewEmployeeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        departments={departmentOptions}
      />
      <ImportEmployeesModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        departments={departmentOptions}
      />
    </div>
  )
}
