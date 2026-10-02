import type { TenantPlan } from '@/api/tenant'
import { tenantPlanLabels, tenantPlanQuota } from '@/api/tenant'
import { tx } from '@/lib/i18n'

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
    tagline: tx('Ekibinizle deneyin, kurulum gerektirmez.'),
    maxEmployees: tenantPlanQuota.Trial,
    features: [
      tx('Çalışan ve organizasyon yönetimi'),
      tx('İzin talepleri ve onay akışı'),
      tx('Puantaj ve masraf beyanı'),
      tx('E-posta bildirimleri'),
    ],
  },
  {
    id: 'Standard',
    name: tenantPlanLabels.Standard,
    tagline: tx('Büyüyen şirketler için tüm modüller açık.'),
    maxEmployees: tenantPlanQuota.Standard,
    highlighted: true,
    features: [
      tx('Deneme planındaki her şey'),
      tx('İşe alım, onboarding ve zimmet'),
      tx('Performans ve eğitim modülleri'),
      tx('Ücret bandı yönetimi'),
      tx('Çok adımlı onay zincirleri'),
      tx('Dışa aktarma (CSV)'),
    ],
  },
  {
    id: 'Enterprise',
    name: tenantPlanLabels.Enterprise,
    tagline: tx('Çok şirketli yapılar ve kurumsal kimlik entegrasyonu.'),
    maxEmployees: tenantPlanQuota.Enterprise,
    features: [
      tx('Standart plandaki her şey'),
      tx('Kurumsal kimlik sağlayıcı federasyonu'),
      tx('Ayrılmış kaynak havuzu'),
      tx('Öncelikli destek ve SLA'),
      tx('Denetim kayıtları'),
    ],
  },
]

export function planById(id: TenantPlan): PlanInfo {
  return PLANS.find((p) => p.id === id) ?? PLANS[0]
}
