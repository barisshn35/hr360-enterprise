/**
 * Herkese açık giriş sayfası.
 *
 * Kaynak: 21st.dev "SaaS Template" (waleedkibhen, id 8948) — sabit navigasyon,
 * duyuru rozeti, gradyan başlık ve panel önizlemesi iskeleti oradan geldi.
 *
 * Uyarlamalar:
 *  - Şablonun tamamı `bg-black` / `text-white` / `bg-gray-800` üzerine kuruluydu;
 *    hepsi token'lara çevrildi, açık temada da doğru görünüyor.
 *  - Şablon Poppins'i kendi içinde `@import` ediyordu; Staffware Geist kullanıyor.
 *  - CDN'deki mockup PNG'leri yerine çalışan bir önizleme (bkz. LivePreview).
 *  - Bölümler ayrı dosyalara bölündü; her biri kendi hareketini taşıyor.
 *
 * Hareket kuralı: her şey `prefers-reduced-motion` altında sessizleşir ama
 * hiçbir içerik kaybolmaz — animasyon bilgi taşır, bilgiyi tek başına tutmaz.
 */

import { useNavigate } from 'react-router-dom'
import { PricingPlans } from '@/features/pricing/PricingPlans'
import { Reveal, ScrollProgress } from '@/motion/primitives'
import { AutomationFlow } from './AutomationFlow'
import { CtaBand } from './CtaBand'
import { Faq } from './Faq'
import { Hero } from './Hero'
import { HowItWorks } from './HowItWorks'
import { LandingFooter } from './LandingFooter'
import { LandingNav } from './LandingNav'
import { MetricsBand } from './MetricsBand'
import { ModulesBento } from './ModulesBento'

export function LandingPage() {
  const navigate = useNavigate()

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <ScrollProgress />
      <LandingNav />

      <Hero />
      <MetricsBand />
      <ModulesBento />
      <AutomationFlow />
      <HowItWorks />

      {/* --------------------------------- Planlar -------------------------------- */}
      <section id="planlar" className="relative scroll-mt-24 px-5 py-20 md:py-28">
        <div className="mx-auto max-w-7xl">
          <Reveal className="mb-12 text-center">
            <p className="mb-3 text-[11px] font-semibold tracking-widest text-primary uppercase">
              Planlar
            </p>
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
              Şirketinize uyan planı seçin
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
              Planlar çalışan kotasına göre ayrışır; modül erişimi plan yükseltmesiyle genişler.
              Planı sonradan değiştirebilirsiniz.
            </p>
          </Reveal>

          <PricingPlans
            mode="showcase"
            ctaLabel="Bu planla başla"
            onCta={(plan) => navigate(`/kayit?plan=${plan}`)}
          />
        </div>
      </section>

      <Faq />
      <CtaBand />
      <LandingFooter />
    </main>
  )
}
