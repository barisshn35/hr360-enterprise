/**
 * Giriş sayfası.
 *
 * Kaynak: 21st.dev "Auth Section 2" (solaceui, id 20036) — iki sütunlu düzen
 * (solda tanıtım paneli, sağda giriş) korundu.
 *
 * Uyarlamalar:
 *  - Sosyal giriş butonları ve e-posta/parola alanları KALDIRILDI. HR360'ta
 *    kimlik doğrulama yalnızca Keycloak üzerinden (Authorization Code + PKCE);
 *    parola bu uygulamaya hiç girilmez, Keycloak'ın kendi ekranında alınır.
 *  - Sol paneldeki galeri yerine rol açıklamaları (önceki sürümde beğenilmişti).
 *  - Sabit siyah/beyaz palet token'lara çevrildi.
 */

import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowRight, KeyRound, ShieldCheck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppShellSkeleton } from '@/components/ui/AppShellSkeleton'
import { useAuth } from '@/auth/useAuth'
import { roleLabels } from '@/auth/roles'
import { EASE, Magnetic, Stagger, StaggerItem } from '@/motion/primitives'

const ROLE_NOTES: Array<{ role: keyof typeof roleLabels; detail: string }> = [
  { role: 'employee', detail: 'Kendi izin, masraf ve eğitim kayıtlarını görür; talep açar.' },
  { role: 'manager', detail: 'Ekibinin taleplerini karara bağlar, puantaj ve performansı yönetir.' },
  { role: 'hr-admin', detail: 'Organizasyon, çalışan kayıtları, ücret bantları ve dokümanlar.' },
  { role: 'platform-admin', detail: 'Kiracıları yönetir: plan, kota, askıya alma ve kurulum kayıtları.' },
]

export function SignInPage() {
  const reduced = useReducedMotion()
  const { status, login, error } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('devam') || '/panel'

  if (status === 'loading') return <AppShellSkeleton label="Oturum doğrulanıyor" />
  if (status === 'authenticated') return <Navigate to={next} replace />

  return (
    <section className="min-h-dvh bg-background p-3 text-foreground antialiased">
      <div className="grid min-h-[calc(100dvh-1.5rem)] gap-6 lg:grid-cols-[0.94fr_1.06fr]">
        {/* --------------------------- Tanıtım / roller --------------------------- */}
        <motion.div
          initial={reduced ? false : { opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7, ease: EASE }}
          className="relative flex justify-center overflow-hidden rounded-xl bg-gradient-to-b from-primary/12 via-card to-card px-7 py-12 sm:px-10 lg:py-20"
        >
          <div
            aria-hidden="true"
            className="hr-aurora pointer-events-none absolute -top-32 -left-24 size-[26rem] rounded-full bg-primary/12 blur-[110px]"
          />
          <div className="relative flex w-full max-w-[480px] flex-col">
            <Link to="/" className="flex items-center gap-3 text-lg font-semibold">
              <img
                src="/icon-emerald.svg"
                alt=""
                aria-hidden="true"
                className="size-7 shrink-0"
              />
              HR360 Enterprise
            </Link>

            <p className="mt-8 text-2xl leading-tight font-medium">
              Gördüğünüz ekran rolünüze göre şekillenir.
            </p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
              Aynı panel, herkese kendi işini gösterir. Yetkiniz olmayan modüller menüde bile
              görünmez.
            </p>

            <Stagger as="ul" className="mt-8 flex flex-col gap-3" delay={0.25} step={0.09}>
              {ROLE_NOTES.map((item) => (
                <StaggerItem
                  key={item.role}
                  as="li"
                  from="left"
                  className="rounded-lg border border-border bg-card/70 p-4 transition-colors hover:border-primary/40"
                >
                  <p className="text-[13px] font-semibold">{roleLabels[item.role]}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                </StaggerItem>
              ))}
            </Stagger>

            <p className="mt-auto flex items-start gap-2 pt-8 text-[12px] leading-relaxed text-muted-foreground">
              <ShieldCheck aria-hidden="true" className="mt-px size-4 shrink-0" strokeWidth={1.5} />
              Yetkilendirme arayüzde gizlenen menülerden ibaret değil; her istek sunucu tarafında
              yeniden denetlenir.
            </p>
          </div>
        </motion.div>

        {/* -------------------------------- Giriş -------------------------------- */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.12, ease: EASE }}
          className="flex items-center justify-center px-6 py-12 sm:px-10 lg:px-14 xl:px-20"
        >
          <div className="w-full max-w-md">
            <h1 className="text-3xl font-semibold tracking-tight">Giriş yapın</h1>
            <p className="mt-2.5 text-[14px] leading-relaxed text-muted-foreground">
              HR360, kurumsal kimlik sunucusu üzerinden doğrulama yapar. Devam ettiğinizde
              şirketinizin oturum açma ekranına yönlendirilirsiniz.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5 text-[13px] leading-relaxed"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                />
                <span>
                  Kimlik sağlayıcıya ulaşılamadı. {error}
                </span>
              </div>
            )}

            <Magnetic strength={0.14} className="mt-8 w-full">
              <Button
                size="lg"
                className="hr-sheen h-12 w-full cursor-pointer text-base"
                onClick={() => login(next)}
              >
                <KeyRound className="size-4.5" strokeWidth={1.75} />
                Kurumsal hesabımla giriş yap
              </Button>
            </Magnetic>

            <div className="my-8 flex items-center gap-4 text-sm text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>şirketiniz henüz kayıtlı değil mi?</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Button variant="outline" size="lg" className="h-12 w-full cursor-pointer" asChild>
              <Link to="/kayit">
                Şirketinizi kaydedin
                <ArrowRight className="size-4" />
              </Link>
            </Button>

            <div className="mt-9 space-y-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                Parolanızı unuttuysanız oturum açma ekranındaki "Parolamı unuttum" bağlantısını
                kullanın — parola bu uygulamaya hiçbir zaman girilmez.
              </p>
              <p>
                Hesabınız olduğu hâlde giriş yapamıyorsanız şirketinizin İK yöneticisi hesabınızı
                askıya almış olabilir.
              </p>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
