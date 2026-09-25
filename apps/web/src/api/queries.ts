import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { employeeApi } from './employees'
import { organizationApi } from './organization'
import { workflowApi, type WorkflowFilters } from './workflows'
import { gatewayApi } from './ml'
import { applyAssignment } from '@/lib/assignments'
import type { Company, CreateAssignmentInput, Department, Employee, Workflow } from './types'

/** Tüm sorgu anahtarları tek yerde — geçersiz kılma hataları önlenir. */
export const qk = {
  companies: ['companies'] as const,
  company: (id: string) => ['companies', id] as const,
  departments: (companyId?: string) => ['departments', companyId ?? 'all'] as const,
  employees: ['employees'] as const,
  employee: (id: string) => ['employees', id] as const,
  workflows: (filters: WorkflowFilters) => ['workflows', filters] as const,
  workflow: (id: string) => ['workflows', 'detail', id] as const,
  overdue: ['workflows', 'overdue'] as const,
  gatewayHealth: ['gateway', 'health'] as const,
}

export function useCompanies(options?: Partial<UseQueryOptions<Company[]>>) {
  return useQuery({
    queryKey: qk.companies,
    queryFn: ({ signal }) => organizationApi.listCompanies(signal),
    ...options,
  })
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: qk.company(id ?? ''),
    queryFn: ({ signal }) => organizationApi.getCompany(id!, signal),
    enabled: Boolean(id),
  })
}

/** Şirketin departmanları (düz liste). Departman başı (`headEmployeeId`) bu uçtan gelir. */
export function useDepartmentList(companyId: string | undefined, options?: Partial<UseQueryOptions<Department[]>>) {
  return useQuery({
    queryKey: qk.departments(companyId),
    queryFn: ({ signal }) => organizationApi.listDepartments(companyId, signal),
    enabled: Boolean(companyId),
    ...options,
  })
}

export function useEmployees(
  options?: Partial<UseQueryOptions<Employee[]>> & { email?: string },
) {
  const { email, ...queryOptions } = options ?? {}
  return useQuery({
    queryKey: email ? [...qk.employees, email] : qk.employees,
    queryFn: ({ signal }) => employeeApi.list(signal, email),
    ...queryOptions,
  })
}

export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: qk.employee(id ?? ''),
    queryFn: ({ signal }) => employeeApi.get(id!, signal),
    enabled: Boolean(id),
  })
}

export function useWorkflows(
  filters: WorkflowFilters = {},
  options?: Partial<UseQueryOptions<Workflow[]>>,
) {
  return useQuery({
    queryKey: qk.workflows(filters),
    queryFn: ({ signal }) => workflowApi.list(filters, signal),
    ...options,
  })
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: qk.workflow(id ?? ''),
    queryFn: ({ signal }) => workflowApi.get(id!, signal),
    enabled: Boolean(id),
  })
}

export function useOverdueWorkflows(options?: Partial<UseQueryOptions<Workflow[]>>) {
  return useQuery({
    queryKey: qk.overdue,
    queryFn: ({ signal }) => workflowApi.listOverdue(signal),
    ...options,
  })
}

export function useGatewayHealth() {
  return useQuery({
    queryKey: qk.gatewayHealth,
    queryFn: ({ signal }) => gatewayApi.health(signal),
    refetchInterval: 60_000,
    retry: 1,
  })
}

/* ------------------------------- Mutasyonlar -------------------------------- */

/**
 * Backend'in yapacağını önbellekte taklit eder (kurallar: src/lib/assignments.ts).
 * Kural ihlalinde (geriye dönük tarih) önbellek değişmez; sunucunun 400'ü gösterilir.
 */
function withAssignment(e: Employee, input: CreateAssignmentInput): Employee {
  const result = applyAssignment(
    e.assignments ?? [],
    { departmentId: input.departmentId, positionTitle: input.positionTitle ?? null, effectiveFrom: input.effectiveFrom },
    `gecici-${e.id}-${input.effectiveFrom}`,
  )
  return result.ok ? { ...e, assignments: result.assignments } : e
}

/**
 * Çalışanı başka departmana atar (`POST /employees/{id}/assignments`).
 *
 * İyimser: çalışan listesi istek sonuçlanmadan güncellenir, kart hemen yeni
 * departmanında görünür. Hata olursa önceki liste geri yüklenir; her durumda
 * sonunda listeler sunucudan tazelenir.
 */
export function useAddAssignment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ employeeId, input }: { employeeId: string; input: CreateAssignmentInput }) =>
      employeeApi.addAssignment(employeeId, input),
    onMutate: async ({ employeeId, input }) => {
      await qc.cancelQueries({ queryKey: qk.employees })
      const previous = qc.getQueryData<Employee[]>(qk.employees)
      if (previous) {
        qc.setQueryData<Employee[]>(
          qk.employees,
          previous.map((e) => (e.id === employeeId ? withAssignment(e, input) : e)),
        )
      }
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(qk.employees, context.previous)
    },
    // qk.employees öneki çalışan ayrıntılarını da kapsar. Departmanlar da tazelenir: taşınan kişi
    // eski departmanın başıysa backend headEmployeeId'yi null'a çeker (organization-service'e
    // best-effort çağrı). Bu promise'ler beklendiği için mutate() çağrısındaki onSuccess/onError
    // çalıştığında önbellek zaten güncel olur.
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.employees }),
        qc.invalidateQueries({ queryKey: ['departments'] }),
      ]),
  })
}

/* Yeni modullerin hooklari ayri dosyada; @/api/queries tek giris noktasi kalir. */
export * from './queries-modules'

/* Tenant Service (cok kiracililik) hooklari. */
export * from './queries-tenant'
