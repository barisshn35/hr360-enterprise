import { motion, useReducedMotion } from 'motion/react'
import { KeyRound, Rocket, Users } from 'lucide-react'
import { EASE, Reveal, useRevealed } from '@/motion/primitives'
import { cn } from '@/lib/utils'

const STEPS = [
  {
    icon: Rocket,
    title: 'Şirketinizi kaydedin',
    detail:
      'Şirket bilgileri, yönetici hesabı ve plan. Kısa ad seçerken müsaitlik anında kontrol edilir. Kredi kartı istenmez.',
    aside: '≈ 2 dakika',
  },
  {
    icon: KeyRound,
    title: 'Ortamınız hazırlanır',
    detail:
      'Kiracınız için ayrı veri alanı, roller ve yönetici hesabı otomatik oluşturulur; parola belirleme bağlantısı e-postanıza gelir.',
    aside: 'Arka planda',
  },
  {
    icon: Users,
    title: 'Ekibinizi taşıyın',
    detail:
      'Çalışanları ekleyin, departman ağacını kurun, onay zincirlerini tanımlayın. Modüller ilk günden açık.',
    aside: 'Aynı gün',
  },
]

export function HowItWorks() {
  const reduced = useReducedMotion()
  const [ref, revealed] = useRevealed<HTMLOListElement>(0.25)

  return (
    <section id="nasil-calisir" className="relative scroll-mt-24 px-5 py-20 md:py-28">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-14 text-center">
          <p className="mb-3 text-[11px] font-semibold tracking-widest text-primary uppercase">
            Nasıl çalışır
          </p>
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
            Üç adımda kurulum
          </h2>
        </Reveal>

        <ol ref={ref} className="relative grid gap-8 md:grid-cols-3 md:gap-6">
          {/* Adımları birbirine bağlayan çizgi — görünürken soldan sağa çizilir. */}
          <span
            aria-hidden="true"
            className="absolute top-6 right-[16.6%] left-[16.6%] hidden h-px overflow-hidden bg-border md:block"
          >
            <motion.span
              className="block h-full w-full origin-left bg-gradient-to-r from-primary via-primary to-primary/30"
              initial={reduced ? false : { scaleX: 0 }}
              animate={revealed ? { scaleX: 1 } : {}}
              transition={{ duration: 1.1, delay: 0.3, ease: EASE }}
            />
          </span>

          {STEPS.map((step, i) => (
            <motion.li
              key={step.title}
              initial={reduced ? false : { opacity: 0, y: 24 }}
              animate={revealed || reduced ? { opacity: 1, y: 0 } : undefined}
              transition={{ duration: 0.6, delay: i * 0.14, ease: EASE }}
              className="relative text-center md:text-left"
            >
              <div className="mb-5 flex justify-center md:justify-start">
                <span
                  className={cn(
                    'relative z-10 flex size-12 items-center justify-center rounded-full border-2 border-primary bg-background',
                    'shadow-[0_0_0_6px_hsl(var(--background))]',
                  )}
                >
                  <step.icon aria-hidden="true" className="size-5 text-primary" strokeWidth={1.75} />
                </span>
              </div>

              <div className="mb-2 flex items-center justify-center gap-2 md:justify-start">
                <span className="tabular text-[11px] font-semibold text-primary">
                  0{i + 1}
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {step.aside}
                </span>
              </div>

              <h3 className="mb-2 text-[17px] font-semibold">{step.title}</h3>
              <p className="mx-auto max-w-sm text-[13px] leading-relaxed text-muted-foreground md:mx-0">
                {step.detail}
              </p>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  )
}
