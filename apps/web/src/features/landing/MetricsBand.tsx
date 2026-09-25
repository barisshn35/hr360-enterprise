import { CountUp, Stagger, StaggerItem } from '@/motion/primitives'
import { formatNumber } from '@/lib/format'

/**
 * Sayı şeridi.
 *
 * Bilerek "500+ şirket bize güveniyor" tarzı bir sosyal kanıt yok — öyle bir
 * veri elimizde yok ve uydurulmuş rakam ilk müşteri görüşmesinde patlar.
 * Buradaki dört sayı ÜRÜNÜN KENDİSİ hakkında ve doğrulanabilir: modül sayısı,
 * rol katmanı, izin matrisindeki izin sayısı ve plan sayısı.
 */
const METRICS = [
  { value: 14, label: 'İK modülü', detail: 'Tek kurulumda hepsi açık' },
  { value: 6, label: 'Rol katmanı', detail: 'Çalışandan platform yöneticisine' },
  { value: 36, label: 'Ayrı izin', detail: 'Menüden butona kadar filtreler' },
  { value: 3, label: 'Plan', detail: '25 çalışandan 10.000’e' },
]

export function MetricsBand() {
  return (
    <section className="relative px-5 py-14">
      <div className="mx-auto max-w-6xl">
        <Stagger className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
          {METRICS.map((metric) => (
            <StaggerItem
              key={metric.label}
              className="group bg-card px-6 py-8 transition-colors duration-300 hover:bg-accent/40"
            >
              <p className="text-4xl leading-none font-semibold tracking-tight sm:text-5xl">
                <CountUp
                  to={metric.value}
                  duration={1.4}
                  format={(v) => formatNumber(Math.round(v))}
                />
              </p>
              <p className="mt-3 text-[14px] font-medium">{metric.label}</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                {metric.detail}
              </p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
