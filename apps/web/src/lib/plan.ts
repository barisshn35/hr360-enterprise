import { useQuery } from '@tanstack/react-query'
import { governanceApi, type PlanName } from '@/api/governance'
import { useAuth } from '@/auth/useAuth'

const RANK: Record<PlanName, number> = { Trial: 1, Standard: 2, Enterprise: 3 }

export const planLabels: Record<PlanName, string> = { Trial: 'Deneme', Standard: 'Standart', Enterprise: 'Kurumsal' }

/**
 * Kiracının planı ve açık özellikleri (governance-service /plan).
 *
 * Yanıt gelmezse (servis kapalı, ağ hatası) hiçbir şey GİZLENMEZ: menüden
 * bir modülü yanlışlıkla saklamak, backend'in zaten 402 döndüreceği bir
 * sayfayı göstermekten daha kötü. Gerçek kısıt backend'deki RequiresPlan'dır.
 */
export function usePlan() {
  const { status, tenantSlug } = useAuth()
  const q = useQuery({
    queryKey: ['plan'],
    queryFn: ({ signal }) => governanceApi.plan(signal),
    enabled: status === 'authenticated',
    staleTime: 5 * 60_000,
    retry: false,
  })
  const data = q.data
  const hasFeature = (feature: string) => {
    // Faturalandırma kurulum ayarıdır (BILLING_ENABLED); kiracı seçmemiş
    // platform yöneticisi de görür (tüm kiracıların faturaları).
    if (feature === 'billing') return data?.billingEnabled === true
    // Yeni modüller kiracı bağlamında çalışır; şirket seçmemiş platform
    // yöneticisine gösterilmez (aksi hâlde her uç "kiracı yok" der).
    if (status === 'authenticated' && !tenantSlug) return false
    if (!data || !data.enforced) return true
    const min = data.features[feature]
    return !min || data.enabled.includes(feature) || RANK[data.plan] >= RANK[min]
  }
  const requiredPlan = (feature: string) => data?.features[feature]
  return { plan: data?.plan, enforced: data?.enforced ?? false, billingEnabled: data?.billingEnabled ?? false, hasFeature, requiredPlan, isLoading: q.isPending, noTenant: status === 'authenticated' && !tenantSlug }
}
