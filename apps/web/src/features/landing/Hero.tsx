import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, BadgeCheck, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EASE, Magnetic, WordReveal } from '@/motion/primitives'
import { LivePreview } from './LivePreview'

/** Hero altındaki güven şeridi — modüller sonsuz döngüde akar. */
const MODULE_STRIP = [
  'Organizasyon',
  'Çalışanlar',
  'Onay akışları',
  'İzin',
  'Puantaj',
  'Masraf',
  'İşe alım',
  'Onboarding',
  'Zimmet',
  'Performans',
  'Eğitim',
  'Ücret',
  'İK vakaları',
  'Dokümanlar',
]

export function Hero() {
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  return (
    <section className="relative overflow-hidden px-5 pt-32 pb-16 md:pt-40">
      {/* ----------------------------- Arka plan katmanları ---------------------------- */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Işık kütleleri: yavaşça sürüklenen üç yumuşak leke */}
        <div className="hr-aurora absolute -top-56 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-primary/12 blur-[130px]" />
        <div className="hr-aurora hr-aurora-slow absolute -top-40 -left-40 size-[22rem] rounded-full bg-[hsl(var(--chart-2))]/10 blur-[120px]" />
        <div className="hr-aurora hr-aurora-delay absolute -top-32 -right-40 size-[24rem] rounded-full bg-[hsl(var(--chart-5))]/8 blur-[130px]" />
        {/* Nokta dokusu */}
        <div className="hr-dots absolute inset-x-0 top-0 h-[42rem] opacity-60" />
      </div>

      <div className="relative mx-auto flex max-w-5xl flex-col items-center">
        {/* -------------------------------- Duyuru rozeti ------------------------------- */}
        <motion.aside
          initial={reduced ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: EASE }}
          className="group mb-8 inline-flex flex-wrap items-center justify-center gap-2 rounded-full border border-border bg-card/70 py-1.5 pr-2 pl-4 shadow-sm backdrop-blur-sm"
        >
          <BadgeCheck aria-hidden="true" className="size-3.5 text-primary" />
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            Çok kiracılı sürüm yayında
          </span>
          <a
            href="#planlar"
            className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Planları gör
            <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
          </a>
        </motion.aside>

        {/* ---------------------------------- Başlık ---------------------------------- */}
        <h1 className="mb-5 max-w-4xl text-center text-4xl leading-[1.08] font-semibold tracking-tight md:text-6xl lg:text-[68px]">
          <WordReveal
            text="İnsan kaynaklarınızın"
            className="flex flex-wrap justify-center gap-x-[0.28em]"
            wordClassName="bg-gradient-to-b from-foreground to-foreground/75 bg-clip-text text-transparent"
          />
          <WordReveal
            text="tamamı tek panelde"
            delay={0.18}
            className="flex flex-wrap justify-center gap-x-[0.28em]"
            wordClassName="bg-gradient-to-b from-foreground to-foreground/50 bg-clip-text text-transparent"
          />
        </h1>

        <motion.p
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: EASE }}
          className="mb-9 max-w-2xl text-center text-[15px] leading-relaxed text-muted-foreground md:text-base"
        >
          Organizasyondan izne, işe alımdan performansa on dört modül. Şirketinizin verisi kendi
          kiracısında izole, erişim rolünüze göre şekillenir, onaylar kendiliğinden işler.
        </motion.p>

        {/* ----------------------------------- CTA'lar ---------------------------------- */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.58, ease: EASE }}
          className="relative z-10 mb-6 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Magnetic>
            <Button
              size="lg"
              className="hr-sheen h-12 cursor-pointer px-7 text-[15px]"
              onClick={() => navigate('/kayit')}
            >
              Şirketinizi kaydedin
              <ArrowRight className="size-4" />
            </Button>
          </Magnetic>
          <Button
            size="lg"
            variant="outline"
            className="h-12 cursor-pointer px-7 text-[15px] backdrop-blur-sm"
            asChild
          >
            <Link to="/giris">Giriş yap</Link>
          </Button>
        </motion.div>

        <motion.p
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.7, delay: 0.72 }}
          className="mb-14 flex items-center gap-1.5 text-[12px] text-muted-foreground"
        >
          <ShieldCheck aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          Kredi kartı istemez · Kurumsal kimlik sağlayıcıyla giriş · Verileriniz izole
        </motion.p>
      </div>

      {/* ------------------------------- Ürün önizlemesi ------------------------------ */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 40, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 1, delay: 0.5, ease: EASE }}
        className="relative z-10 mx-auto w-full max-w-5xl"
      >
        <LivePreview />
      </motion.div>

      {/* --------------------------------- Modül şeridi -------------------------------- */}
      <motion.div
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 1 }}
        className="relative mx-auto mt-16 max-w-6xl"
      >
        <p className="mb-4 text-center text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          On dört modül, tek kurulum
        </p>
        <div className="hr-marquee-mask flex overflow-hidden">
          <div className="hr-marquee flex shrink-0 items-center gap-3 pr-3">
            {[...MODULE_STRIP, ...MODULE_STRIP].map((label, i) => (
              <span
                key={`${label}-${i}`}
                className="shrink-0 rounded-full border border-border bg-card/60 px-4 py-1.5 text-[13px] whitespace-nowrap text-muted-foreground backdrop-blur-sm"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  )
}
