import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tenantApi, type TenantFilters, type TenantPlan } from './tenant'

/** Tenant Service sorgu anahtarları. */
export const qkt = {
  myTenant: ['tenant', 'me'] as const,
  tenants: (f: TenantFilters) => ['tenant', 'list', f] as const,
  tenant: (id: string) => ['tenant', 'detail', id] as const,
  slug: (slug: string) => ['tenant', 'slug', slug] as const,
}

/**
 * Kullanıcının kendi kiracısı. Sidebar'daki TenantSwitcher bunu gösteriyor,
 * yani her sayfada canlı — bayatlama süresi uzun tutuluyor.
 */
export function useMyTenant(enabled = true) {
  return useQuery({
    queryKey: qkt.myTenant,
    queryFn: ({ signal }) => tenantApi.myTenant(signal),
    enabled,
    staleTime: 5 * 60_000,
    // Gateway'de /api/tenant/* route'u yoksa 404/502 döner; sonsuz denemeye girmesin.
    retry: false,
  })
}

/** Platform paneli — yalnızca platform:manage izni olan kullanıcı çağırır. */
export function useTenants(filters: TenantFilters = {}, enabled = true) {
  return useQuery({
    queryKey: qkt.tenants(filters),
    queryFn: ({ signal }) => tenantApi.list(filters, signal),
    enabled,
  })
}

export function useTenant(id: string | undefined) {
  return useQuery({
    queryKey: qkt.tenant(id ?? ''),
    queryFn: ({ signal }) => tenantApi.get(id!, signal),
    enabled: Boolean(id),
  })
}

/**
 * Slug müsaitlik kontrolü. Kayıt sihirbazında her tuşta değil, çağıran taraf
 * debounce ettikten sonra tetiklenir; sonuç anahtarda tutulduğu için geri
 * dönülen slug'lar yeniden sorgulanmaz.
 */
export function useSlugAvailability(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: qkt.slug(slug),
    queryFn: ({ signal }) => tenantApi.slugAvailable(slug, signal),
    enabled: enabled && slug.length >= 3,
    staleTime: 60_000,
    retry: false,
  })
}

/* ------------------------------- Mutasyonlar -------------------------------- */

function useTenantMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenant'] })
    },
  })
}

export function useSuspendTenant() {
  return useTenantMutation(({ id, reason }: { id: string; reason: string }) =>
    tenantApi.suspend(id, reason),
  )
}

export function useReactivateTenant() {
  return useTenantMutation(({ id }: { id: string }) => tenantApi.reactivate(id))
}

export function useChangeTenantPlan() {
  return useTenantMutation(
    ({ id, plan, maxEmployees }: { id: string; plan: TenantPlan; maxEmployees: number }) =>
      tenantApi.changePlan(id, plan, maxEmployees),
  )
}

/** Kayıt sihirbazının son adımı. Anonim uç — oturum gerekmez. */
export function useRegisterTenant() {
  return useMutation({ mutationFn: tenantApi.register })
}
