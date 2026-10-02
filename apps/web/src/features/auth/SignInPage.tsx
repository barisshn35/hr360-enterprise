/**
 * Giriş sayfası — tek sütun, sahne ışıklı.
 *
 * 21st.dev kaynakları:
 *  - "Lamp" (aceternity, id 900): üstten vuran zümrüt ışık konisi
 *  - "Background Beams With Collision" (aceternity, id 1497): zemine çarpıp
 *    kıvılcım saçan hüzmeler
 *  - "Border Beam" (Magic UI, id 1268): giriş kartının kenarında dolaşan ışık
 *  - "Text Generate Effect" / "Animated Shiny Text": başlık ve rozet
 *  - "Orbiting Circles" (Magic UI, id 1411): marka işaretinin yörüngesi
 *
 * Kimlik doğrulama yalnızca Keycloak üzerinden (Authorization Code + PKCE);
 * parola bu uygulamaya hiç girilmez.
 */

import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  BadgeDollarSign,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  GraduationCap,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Target,
  TriangleAlert,
  UserPlus,
  Wallet,
  Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton'
import { AmbientBackground } from '@/components/fx/ambient-background'
import { Lamp } from '@/components/fx/lamp'
import { Beams } from '@/components/fx/beams'
import { BorderBeam } from '@/components/fx/border-beam'
import { OrbitingCircles } from '@/components/fx/orbiting-circles'
import { TextReveal } from '@/components/fx/text-reveal'
import { GradientText, ShinyText } from '@/components/fx/shiny-text'
import { useAuth } from '@/auth/useAuth'
import { EASE } from '@/motion/primitives'

const MODULES = [
  { icon: CalendarDays, label: 'İzin' },
  { icon: Wallet, label: 'Masraf' },
  { icon: Target, label: 'Performans' },
  { icon: CalendarClock, label: 'Vardiya' },
  { icon: UserPlus, label: 'İşe alım' },
  { icon: ClipboardCheck, label: 'Onboarding' },
  { icon: BadgeDollarSign, label: 'Ücret' },
  { icon: GraduationCap, label: 'Eğitim' },
]

const TRUST = [
  { icon: LockKeyhole, text: 'Parola bu uygulamaya girilmez' },
  { icon: ShieldCheck, text: 'Her istek sunucuda denetlenir' },
  { icon: Building2, text: 'Her şirketin verisi ayrı' },
]

export function SignInPage() {
  const reduced = useReducedMotion()
  const { status, login, error } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('devam') || '/panel'

  if (status === 'loading') return <AppShellSkeleton label="Oturum doğrulanıyor" />
  if (status === 'authenticated') return <Navigate to={next} replace />

  const up = (delay: number) =>
    reduced
      ? {}
      : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, delay, ease: EASE } }

  return (
    <main className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-background px-5 text-foreground">
      <AmbientBackground />
      <Lamp />
      <Beams className="top-[45%]" />

      <div className="relative z-10 flex w-full max-w-[460px] flex-1 flex-col items-center pt-[14vh] pb-10">
        {/* Marka işareti ve yörüngesi */}
        <motion.div {...up(0)} className="relative flex size-36 items-center justify-center">
          <span className="relative z-10 flex size-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-primary to-[hsl(170_80%_30%)] shadow-[0_0_60px_-8px_hsl(var(--primary))]">
            <img src="/icon-white.svg" alt="" aria-hidden="true" className="size-9" />
          </span>
          <OrbitingCircles radius={56} duration={12} className="size-2.5 bg-primary shadow-[0_0_12px_hsl(var(--primary))]" />
          <OrbitingCircles radius={56} duration={12} angle={180} path={false} className="size-1.5 bg-[hsl(170_85%_60%)]" />
        </motion.div>

        <motion.div
          {...up(0.1)}
          className="mt-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.08] px-3.5 py-1 text-[12px] font-medium backdrop-blur"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-primary" />
          <ShinyText>HR360 Enterprise</ShinyText>
        </motion.div>

        <h1 className="mt-5 text-center text-[38px] leading-[1.05] font-semibold tracking-[-0.045em] sm:text-[52px]">
          <TextReveal text="İnsan kaynakları," delay={0.15} />
          <br />
          <GradientText>tek ışıkta.</GradientText>
        </h1>
        <motion.p {...up(0.35)} className="mt-4 max-w-sm text-center text-[14.5px] leading-relaxed text-muted-foreground">
          Kimliğiniz kurumsal kimlik sunucusunda doğrulanır; gördüğünüz ekran rolünüze göre şekillenir.
        </motion.p>

        <motion.div {...up(0.45)} className="mt-9 w-full">
          <Card className="gap-0 overflow-hidden p-6 sm:p-7">
            <BorderBeam size={200} duration={9} />
            <BorderBeam size={200} duration={9} delay={4.5} colorFrom="hsl(170 85% 60%)" colorTo="transparent" />

            {error && (
              <div
                role="alert"
                className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.08] p-3.5 text-[13px] leading-relaxed"
              >
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>Kimlik sağlayıcıya ulaşılamadı. {error}</span>
              </div>
            )}

            <Button size="lg" className="group h-12 w-full text-[15px]" onClick={() => login(next)}>
              <KeyRound className="size-4.5 transition-transform group-hover:-rotate-12" strokeWidth={1.75} />
              Kurumsal hesabımla giriş yap
            </Button>

            <div className="my-5 flex items-center gap-3 text-[12px] text-muted-foreground">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-border" />
              şirketiniz kayıtlı değil mi?
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-border" />
            </div>

            <Button variant="outline" size="lg" className="group h-12 w-full" asChild>
              <Link to="/kayit">
                Şirketinizi kaydedin
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
            </Button>

            <p className="mt-5 text-center text-[11.5px] leading-relaxed text-muted-foreground">
              Parolanızı unuttuysanız oturum açma ekranındaki “Parolamı unuttum” bağlantısını kullanın.
              Giriş yapamıyorsanız İK yöneticiniz hesabınızı askıya almış olabilir.
            </p>
          </Card>
        </motion.div>

        <motion.ul {...up(0.6)} className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12px] text-muted-foreground">
          {TRUST.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-1.5">
              <Icon aria-hidden="true" className="size-3.5 text-primary" strokeWidth={1.75} />
              {text}
            </li>
          ))}
        </motion.ul>
      </div>

      {/* Modül kayan şeridi */}
      <motion.div {...up(0.7)} className="hr-marquee-mask relative z-10 w-full max-w-4xl overflow-hidden pb-8" aria-hidden="true">
        <div className="hr-marquee flex w-max gap-3">
          {[...MODULES, ...MODULES].map((m, i) => (
            <span
              key={i}
              className="flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-[12.5px] text-muted-foreground backdrop-blur"
            >
              <m.icon className="size-3.5 text-primary" strokeWidth={1.75} />
              {m.label}
            </span>
          ))}
        </div>
      </motion.div>
    </main>
  )
}
