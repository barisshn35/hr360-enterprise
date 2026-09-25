import type { TenantPlan } from '@/api/tenant'
import { tenantPlanLabels, tenantPlanQuota } from '@/api/tenant'

/**
 * Plan kataloğu. Hem landing'deki plan bölümü hem kayıt sihirbazının 3. adımı
 * buradan besleniyor — iki yerde ayrı liste tutulursa kaçınılmaz olarak ayrışır.
 *
 * NOT: Devir notunda para birimi/fiyat bilgisi yok. Uydurmak yerine başlık
 * rakamı olarak ÇALIŞAN KOTASI gösteriliyor; fiyat netleşince `priceLabel`
 * alanı doldurulabilir.
 */
export interface PlanInfo {
  id: TenantPlan
  name: string
  tagline: string
  maxEmployees: number
  /** Fiyat netleştiğinde doldurulur; boşsa kota öne çıkar. */
  priceLabel?: string
  features: string[]
  highlighted?: boolean
}

export const PLANS: PlanInfo[] = [
  {
    id: 'Trial',
    name: tenantPlanLabels.Trial,
    tagline: 'Ekibinizle deneyin, kurulum gerektirmez.',
    maxEmployees: tenantPlanQuota.Trial,
    features: [
      'Çalışan ve organizasyon yönetimi',
      'İzin talepleri ve onay akışı',
      'Puantaj ve masraf beyanı',
      'E-posta bildirimleri',
    ],
  },
  {
    id: 'Standard',
    name: tenantPlanLabels.Standard,
    tagline: 'Büyüyen şirketler için tüm modüller açık.',
    maxEmployees: tenantPlanQuota.Standard,
    highlighted: true,
    features: [
      'Deneme planındaki her şey',
      'İşe alım, onboarding ve zimmet',
      'Performans ve eğitim modülleri',
      'Ücret bandı yönetimi',
      'Çok adımlı onay zincirleri',
      'Dışa aktarma (CSV)',
    ],
  },
  {
    id: 'Enterprise',
    name: tenantPlanLabels.Enterprise,
    tagline: 'Çok şirketli yapılar ve kurumsal kimlik entegrasyonu.',
    maxEmployees: tenantPlanQuota.Enterprise,
    features: [
      'Standart plandaki her şey',
      'Kurumsal kimlik sağlayıcı federasyonu',
      'Ayrılmış kaynak havuzu',
      'Öncelikli destek ve SLA',
      'Denetim kayıtları',
    ],
  },
]

export function planById(id: TenantPlan): PlanInfo {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]
}
