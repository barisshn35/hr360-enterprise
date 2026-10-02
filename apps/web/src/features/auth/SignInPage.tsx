/**
 * Giriş sayfası.
 *
 * Kaynak: 21st.dev "Split Login" (mohammadshehadeh / Hirael login-03, id 28369)
 * — iki sütunlu düzen: solda akan çizgili marka paneli, sağda tek eylemli
 * giriş. Önceki sürümün rol açıklamaları sol panelde kısa kartlar olarak
 * korundu.
 *
 * Uyarlamalar:
 *  - GitHub düğmesi yerine Keycloak (Authorization Code + PKCE). Parola bu
 *    uygulamaya hiç girilmez, kimlik sunucusunun kendi ekranında alınır.
 *  - Alıntı bloğu yerine rol kartları ve güvenlik notları.
 *  - Renkler tasarım token'larından; kiracı rengi burada da geçerli.
 */

import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  Building2,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  TriangleAlert,
  UserRound,
  UsersRound,
  Briefcase,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton'
import { FloatingPaths } from '@/components/ui/floating-paths'
import { useAuth } from '@/auth/useAuth'
import { roleLabels } from '@/auth/roles'
import { EASE, Stagger, StaggerItem } from '@/motion/primitives'

const ROLE_NOTES: Array<{ role: keyof typeof roleLabels; icon: React.ElementType; detail: string }> = [
  { role: 'employee', icon: UserRound, detail: 'İzin, masraf ve eğitim kayıtları; talep açar.' },
  { role: 'manager', icon: UsersRound, detail: 'Ekibin taleplerini onaylar, puantaj ve performansı yönetir.' },
  { role: 'hr-admin', icon: Briefcase, detail: 'Organizasyon, çalışan kayıtları, ücret ve dokümanlar.' },
  { role: 'platform-admin', icon: Building2, detail: 'Kiracılar: plan, kota, askıya alma, kurulum kayıtları.' },
]

const TRUST = [
  { icon: LockKeyhole, text: 'Parola bu uygulamaya girilmez' },
  { icon: ShieldCheck, text: 'Her istek sunucuda yeniden denetlenir' },
  { icon: Building2, text: 'Her şirketin verisi ayrı tutulur' },
]

const ENTER = { opacity: 0, y: 14 }

function BrandMark({ className = 'size-7' }: { className?: string }) {
  return <img src="/icon-emerald.svg" alt="" aria-hidden="true" className={`${className} shrink-0`} />
}

export function SignInPage() {
  const reduced = useReducedMotion()
  const { status, login, error } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('devam') || '/panel'

  if (status === 'loading') return <AppShellSkeleton label="Oturum doğrulanıyor" />
  if (status === 'authenticated') return <Navigate to={next} replace />

  const enter = (i: number) =>
    reduced
      ? {}
      : {
          initial: ENTER,
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay: i * 0.07, ease: EASE },
        }

  return (
    <section className="relative min-h-dvh overflow-hidden bg-background text-foreground lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ------------------------------ Marka paneli ------------------------------ */}
      <aside className="relative hidden h-full flex-col overflow-hidden border-e border-border bg-card p-10 lg:flex xl:p-14">
        <FloatingPaths />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-transparent via-card/40 to-background"
        />
        <div
          aria-hidden="true"
          className="hr-aurora absolute -top-40 -left-32 size-[32rem] rounded-full bg-primary/15 blur-[120px]"
        />

        <motion.div {...enter(0)} className="relative z-10">
          <Link to="/" className="inline-flex items-center gap-2.5 text-[17px] font-semibold tracking-tight">
            <BrandMark />
            HR360 <span className="font-normal text-muted-foreground">Enterprise</span>
          </Link>
        </motion.div>

        <div className="relative z-10 mt-auto max-w-xl">
          <motion.p
            {...enter(1)}
            className="text-gradient text-[34px] leading-[1.12] font-semibold tracking-[-0.03em] xl:text-[40px]"
          >
            İnsan kaynaklarınız, tek ve güvenli bir panelde.
          </motion.p>
          <motion.p {...enter(2)} className="mt-4 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            Gördüğünüz ekran rolünüze göre şekillenir; yetkiniz olmayan modüller menüde bile
            görünmez.
          </motion.p>

          <Stagger as="ul" className="mt-8 grid grid-cols-2 gap-2.5" delay={0.3} step={0.07}>
            {ROLE_NOTES.map(({ role, icon: Icon, detail }) => (
              <StaggerItem
                key={role}
                as="li"
                className="surface rounded-xl bg-card/70 p-3.5 backdrop-blur-sm transition-colors hover:border-primary/35"
              >
                <p className="flex items-center gap-2 text-[13px] font-semibold">
                  <Icon aria-hidden="true" className="size-4 text-primary" strokeWidth={1.75} />
                  {roleLabels[role]}
                </p>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{detail}</p>
              </StaggerItem>
            ))}
          </Stagger>

          <motion.ul
            {...enter(6)}
            className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-muted-foreground"
          >
            {TRUST.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-1.5">
                <Icon aria-hidden="true" className="size-3.5 text-primary/80" strokeWidth={1.75} />
                {text}
              </li>
            ))}
          </motion.ul>
        </div>
      </aside>

      {/* --------------------------------- Giriş --------------------------------- */}
      <div className="relative flex min-h-dvh flex-col justify-center px-6 py-12 sm:px-10 lg:min-h-0">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-48 right-0 h-[36rem] w-[36rem] rounded-full bg-primary/[0.07] blur-[100px]" />
          <div className="hr-dots absolute inset-0 opacity-60" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-sm">
          <motion.div {...enter(0)} className="mb-10 flex items-center gap-2.5 lg:hidden">
            <BrandMark />
            <span className="text-[17px] font-semibold tracking-tight">HR360 Enterprise</span>
          </motion.div>

          <motion.span
            {...enter(1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary"
          >
            <span className="size-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            Kurumsal oturum
          </motion.span>
          <motion.h1
            {...enter(2)}
            className="mt-4 text-[34px] leading-tight font-semibold tracking-[-0.03em] sm:text-[40px]"
          >
            Giriş yapın
          </motion.h1>
          <motion.p {...enter(3)} className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            HR360 kimliğinizi kurumsal kimlik sunucusunda doğrular. Devam ettiğinizde şirketinizin
            oturum açma ekranına yönlendirilirsiniz.
          </motion.p>

          {error && (
            <div
              role="alert"
              className="mt-6 flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/[0.06] p-3.5 text-[13px] leading-relaxed"
            >
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>Kimlik sağlayıcıya ulaşılamadı. {error}</span>
            </div>
          )}

          <motion.div {...enter(4)} className="mt-8">
            <Button size="lg" className="hr-sheen h-12 w-full text-[15px]" onClick={() => login(next)}>
              <KeyRound className="size-4.5" strokeWidth={1.75} />
              Kurumsal hesabımla giriş yap
            </Button>
          </motion.div>

          <motion.div
            {...enter(5)}
            className="my-7 flex items-center gap-4 text-[12.5px] text-muted-foreground"
          >
            <div className="h-px flex-1 bg-border" />
            <span>şirketiniz kayıtlı değil mi?</span>
            <div className="h-px flex-1 bg-border" />
          </motion.div>

          <motion.div {...enter(6)}>
            <Button variant="outline" size="lg" className="group h-12 w-full" asChild>
              <Link to="/kayit">
                Şirketinizi kaydedin
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </Button>
          </motion.div>

          <motion.div
            {...enter(7)}
            className="mt-10 space-y-2.5 border-t border-border pt-6 text-[12px] leading-relaxed text-muted-foreground"
          >
            <p>
              Parolanızı unuttuysanız oturum açma ekranındaki “Parolamı unuttum” bağlantısını
              kullanın.
            </p>
            <p>
              Hesabınız olduğu hâlde giriş yapamıyorsanız şirketinizin İK yöneticisi hesabınızı
              askıya almış olabilir.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
