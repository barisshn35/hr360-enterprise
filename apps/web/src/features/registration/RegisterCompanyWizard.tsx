/**
 * Şirket kaydı sihirbazı — çok kiracılılığın giriş kapısı.
 *
 * Kaynak: 21st.dev "Onboarding Wizard Form" (cnippet-dev, id 25064). Adım
 * göstergesi, adım adım ilerleme, özet ve başarı ekranı yapısı oradan.
 *
 * Uyarlamalar:
 *  - Şablonun alan bileşenleri Base UI üzerine kuruluydu; projede zaten Radix
 *    tabanlı shadcn primitifleri var. İkinci bir bileşen kitaplığı taşımamak
 *    için alanlar mevcut primitiflerle yeniden kuruldu.
 *  - Üç adım yerine dört: şirket → yönetici → plan → özet.
 *  - Slug alanında canlı müsaitlik kontrolü (debounce 400 ms).
 *
 * KRİTİK: `POST /api/tenant/registration` ANONİM bir uç — bu ekran oturum
 * açmadan çalışır, istek Authorization başlığı taşımaz (bkz. tenantApi.register).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheck,
  LoaderCircle,
  TriangleAlert,
  X,
} from 'lucide-react'
import { ApiError } from '@/api/client'
import { slugify, tenantPlanLabels, type TenantPlan } from '@/api/tenant'
import { useRegisterTenant, useSlugAvailability } from '@/api/queries-tenant'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PricingPlans } from '@/features/pricing/PricingPlans'
import { planById } from '@/features/pricing/plans'
import { EASE } from '@/motion/primitives'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

const STEPS = ['Şirket', 'Yönetici', 'Plan', 'Özet'] as const
type StepIndex = 0 | 1 | 2 | 3

interface FormState {
  companyName: string
  slug: string
  taxNumber: string
  emailDomain: string
  adminFullName: string
  adminEmail: string
  plan: TenantPlan
}

type Errors = Partial<Record<keyof FormState, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/

function validate(step: StepIndex, values: FormState, slugTaken: boolean): Errors {
  const errors: Errors = {}

  if (step === 0) {
    if (values.companyName.trim().length < 2) errors.companyName = 'Şirket adı en az 2 karakter olmalı.'
    if (!values.slug) errors.slug = 'Kısa ad zorunlu.'
    else if (values.slug.length < 3) errors.slug = 'Kısa ad en az 3 karakter olmalı.'
    else if (values.slug.length > 40) errors.slug = 'Kısa ad en fazla 40 karakter olabilir.'
    else if (!SLUG_RE.test(values.slug))
      errors.slug = 'Yalnızca küçük harf, rakam ve tire kullanın (tire başta/sonda olamaz).'
    else if (slugTaken) errors.slug = 'Bu kısa ad kullanımda. Başka bir tane deneyin.'

    if (values.taxNumber && !/^\d{10,11}$/.test(values.taxNumber))
      errors.taxNumber = 'Vergi numarası 10 veya 11 hane olmalı.'

    if (values.emailDomain && !DOMAIN_RE.test(values.emailDomain.toLowerCase()))
      errors.emailDomain = 'Geçerli bir alan adı girin (ör. sirket.com.tr).'
  }

  if (step === 1) {
    if (values.adminFullName.trim().length < 3)
      errors.adminFullName = 'Yöneticinin ad soyadını girin.'
    if (!EMAIL_RE.test(values.adminEmail.trim()))
      errors.adminEmail = 'Geçerli bir e-posta adresi girin.'
  }

  return errors
}

function Field({
  id,
  label,
  hint,
  error,
  optional,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
        {optional && <span className="font-normal text-muted-foreground">(isteğe bağlı)</span>}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="text-[12px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function RegisterCompanyWizard() {
  const [params] = useSearchParams()
  const planFromUrl = params.get('plan')

  const reduced = useReducedMotion()
  const [step, setStep] = useState<StepIndex>(0)
  // Geçişin yönü: ileri +1, geri -1. Slayt yönü buradan geliyor.
  const direction = useRef(1)
  const goToStep = (next: StepIndex) => {
    direction.current = next >= step ? 1 : -1
    setStep(next)
  }
  const [errors, setErrors] = useState<Errors>({})
  const [slugTouched, setSlugTouched] = useState(false)
  const [values, setValues] = useState<FormState>({
    companyName: '',
    slug: '',
    taxNumber: '',
    emailDomain: '',
    adminFullName: '',
    adminEmail: '',
    plan:
      planFromUrl === 'Trial' || planFromUrl === 'Standard' || planFromUrl === 'Enterprise'
        ? planFromUrl
        : 'Standard',
  })

  const register = useRegisterTenant()

  /* --------------------------- Slug müsaitlik kontrolü --------------------------- */
  const [debouncedSlug, setDebouncedSlug] = useState('')
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSlug(values.slug), 400)
    return () => window.clearTimeout(id)
  }, [values.slug])

  const slugQueryable = SLUG_RE.test(debouncedSlug) && debouncedSlug.length >= 3
  const slugCheck = useSlugAvailability(debouncedSlug, slugQueryable)
  const slugSettled = slugQueryable && debouncedSlug === values.slug && slugCheck.isSuccess
  const slugTaken = slugSettled && slugCheck.data?.available === false

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setValues((prev) => {
      // Kısa ad kullanıcı elle değiştirene kadar şirket adından türetilir.
      if (key === 'companyName' && !slugTouched) {
        return { ...prev, companyName: value as string, slug: slugify(value as string) }
      }
      return { ...prev, [key]: value }
    })
    setErrors((prev) => ({ ...prev, [key]: undefined }))
  }

  const goNext = () => {
    const found = validate(step, values, Boolean(slugTaken))
    setErrors(found)
    if (Object.keys(found).length === 0) goToStep(Math.min(3, step + 1) as StepIndex)
  }

  const submit = () => {
    // Son bir kez iki veri adımını da doğrula — özetten geri dönülmüş olabilir.
    const found = { ...validate(0, values, Boolean(slugTaken)), ...validate(1, values, false) }
    if (Object.keys(found).length > 0) {
      setErrors(found)
      goToStep(found.companyName || found.slug || found.taxNumber || found.emailDomain ? 0 : 1)
      return
    }
    register.mutate({
      companyName: values.companyName.trim(),
      adminEmail: values.adminEmail.trim(),
      adminFullName: values.adminFullName.trim() || undefined,
      slug: values.slug,
      emailDomain: values.emailDomain.trim().toLowerCase() || undefined,
      taxNumber: values.taxNumber.trim() || undefined,
      plan: values.plan,
    })
  }

  const submitError = useMemo(() => {
    const error = register.error
    if (!error) return null
    if (error instanceof ApiError) {
      if (error.status === 409) {
        return {
          title: 'Bu bilgilerle zaten bir kayıt var',
          detail: error.message,
        }
      }
      if (error.status === 404 || error.status === 502 || error.status === 503) {
        return {
          title: 'Kayıt servisine ulaşılamıyor',
          detail:
            'Sunucu şu anda yanıt vermiyor. Birkaç dakika sonra tekrar deneyin; sorun sürerse bize ulaşın.',
        }
      }
      return { title: 'Kayıt tamamlanamadı', detail: error.message }
    }
    return {
      title: 'Kayıt tamamlanamadı',
      detail: 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.',
    }
  }, [register.error])

  /* ---------------------------------- Başarı ---------------------------------- */
  if (register.isSuccess) {
    const result = register.data
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-16">
        <div className="w-full max-w-md text-center">
          <motion.span
            initial={reduced ? false : { scale: 0.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            className="relative mx-auto mb-5 flex size-12 items-center justify-center rounded-full bg-[hsl(var(--success))]/12"
          >
            {!reduced && (
              <span className="hr-ring absolute inset-0 rounded-full border-2 border-[hsl(var(--success))]" />
            )}
            <CircleCheck className="size-6 text-[hsl(var(--success))]" strokeWidth={1.75} />
          </motion.span>
          <h1 className="text-2xl font-semibold tracking-tight">Kaydınız alındı</h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">{result.companyName}</strong> için
            çalışma alanı hazırlanıyor. E-postanıza parola belirleme bağlantısı gönderildi.
          </p>

          <dl className="mt-6 rounded-lg border border-border bg-card p-4 text-left text-[13px]">
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Kısa ad</dt>
              <dd className="font-mono font-medium">{result.slug}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Yönetici e-postası</dt>
              <dd className="truncate font-medium">{values.adminEmail}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-1">
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium">{tenantPlanLabels[values.plan]}</dd>
            </div>
          </dl>

          {result.message && (
            <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">{result.message}</p>
          )}

          <p className="mt-6 text-[12px] leading-relaxed text-muted-foreground">
            Bağlantı gelmediyse istenmeyen posta klasörünü kontrol edin. Kurulum birkaç dakika
            sürebilir.
          </p>

          <Button className="mt-7 w-full cursor-pointer" asChild>
            <Link to="/giris">Giriş ekranına git</Link>
          </Button>
        </div>
      </main>
    )
  }

  /* --------------------------------- Sihirbaz --------------------------------- */
  return (
    <main className="min-h-dvh bg-background px-5 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-3xl">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight"
        >
          <img
            src="/icon-emerald.svg"
            alt=""
            aria-hidden="true"
            className="size-7 shrink-0"
          />
          Staffware
        </Link>

        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Şirketinizi kaydedin</h1>
        <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
          Birkaç dakika sürer. Kaydı tamamladığınızda şirketiniz için ayrı bir çalışma alanı
          oluşturulur ve yönetici hesabınıza parola belirleme bağlantısı gönderilir.
        </p>

        {/* Adım göstergesi */}
        <ol className="mt-8 mb-7 flex items-center gap-2" aria-label="Kayıt adımları">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-current={index === step ? 'step' : undefined}
                className={cn(
                  'tabular flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  index < step
                    ? 'bg-primary text-primary-foreground'
                    : index === step
                      ? 'bg-primary/15 text-primary ring-2 ring-primary/40'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {index < step ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
              </span>
              <span
                className={cn(
                  'hidden text-xs font-medium sm:inline',
                  index === step ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {label}
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden="true" className="relative h-px min-w-4 flex-1 bg-border">
                  <motion.span
                    className="absolute inset-0 origin-left bg-primary"
                    initial={false}
                    animate={{ scaleX: index < step ? 1 : 0 }}
                    transition={{ duration: reduced ? 0 : 0.4, ease: EASE }}
                  />
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="rounded-xl border border-border bg-card p-5 sm:p-7">
          {/*
            Adımlar arası geçiş. İleri giderken içerik sağdan, geri dönerken
            soldan geliyor — kullanıcı hangi yöne hareket ettiğini görüyor.
            `mode="wait"` iki adımın üst üste binmesini engelliyor.
          */}
          <AnimatePresence mode="wait" initial={false} custom={direction.current}>
            <motion.div
              key={step}
              custom={direction.current}
              initial={reduced ? false : { opacity: 0, x: direction.current * 28 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduced ? undefined : { opacity: 0, x: direction.current * -28 }}
              transition={{ duration: 0.32, ease: EASE }}
            >
          {/* ------------------------------ 1. Şirket ------------------------------ */}
          {step === 0 && (
            <div className="flex flex-col gap-5">
              <Field id="companyName" label="Şirket adı" error={errors.companyName}>
                <Input
                  id="companyName"
                  value={values.companyName}
                  onChange={(e) => set('companyName', e.target.value)}
                  placeholder="Acme Holding A.Ş."
                  autoComplete="organization"
                  aria-invalid={Boolean(errors.companyName)}
                />
              </Field>

              <Field
                id="slug"
                label="Kısa ad"
                error={errors.slug}
                hint="Çalışma alanınızın adresinde ve kayıtlarınızda kullanılır. Sonradan değiştirilemez."
              >
                <div className="relative">
                  <Input
                    id="slug"
                    value={values.slug}
                    onChange={(e) => {
                      setSlugTouched(true)
                      set('slug', e.target.value.toLowerCase())
                    }}
                    placeholder="acme-holding"
                    className="pr-10 font-mono"
                    aria-invalid={Boolean(errors.slug) || Boolean(slugTaken)}
                    aria-describedby="slug-durum"
                  />
                  <span className="absolute top-1/2 right-3 -translate-y-1/2">
                    {slugQueryable && slugCheck.isFetching ? (
                      <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                    ) : slugSettled && slugCheck.data?.available ? (
                      <Check className="size-4 text-[hsl(var(--success))]" strokeWidth={2.5} />
                    ) : slugTaken ? (
                      <X className="size-4 text-destructive" strokeWidth={2.5} />
                    ) : null}
                  </span>
                </div>
                <p id="slug-durum" aria-live="polite" className="sr-only">
                  {slugCheck.isFetching
                    ? 'Kısa ad kontrol ediliyor'
                    : slugTaken
                      ? 'Bu kısa ad kullanımda'
                      : slugSettled
                        ? 'Bu kısa ad müsait'
                        : ''}
                </p>
                {slugSettled && slugCheck.data?.available && !errors.slug && (
                  <p className="text-[12px] text-[hsl(var(--success))]">Bu kısa ad müsait.</p>
                )}
                {slugCheck.isError && (
                  <p className="text-[12px] text-muted-foreground">
                    Müsaitlik kontrolü yapılamadı; kaydı yine de deneyebilirsiniz.
                  </p>
                )}
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="taxNumber" label="Vergi numarası" optional error={errors.taxNumber}>
                  <Input
                    id="taxNumber"
                    value={values.taxNumber}
                    inputMode="numeric"
                    onChange={(e) => set('taxNumber', e.target.value.replace(/\D/g, ''))}
                    placeholder="1234567890"
                    className="tabular"
                    aria-invalid={Boolean(errors.taxNumber)}
                  />
                </Field>

                <Field
                  id="emailDomain"
                  label="E-posta alan adı"
                  optional
                  error={errors.emailDomain}
                  hint="Bu alan adındaki çalışanlar otomatik eşleştirilir."
                >
                  <Input
                    id="emailDomain"
                    value={values.emailDomain}
                    onChange={(e) => set('emailDomain', e.target.value)}
                    placeholder="acme.com.tr"
                    aria-invalid={Boolean(errors.emailDomain)}
                  />
                </Field>
              </div>
            </div>
          )}

          {/* ----------------------------- 2. Yönetici ----------------------------- */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Bu kişi şirketinizin ilk yöneticisi olur: çalışanları ekler, rolleri dağıtır ve
                onay zincirlerini kurar.
              </p>

              <Field id="adminFullName" label="Ad soyad" error={errors.adminFullName}>
                <Input
                  id="adminFullName"
                  value={values.adminFullName}
                  onChange={(e) => set('adminFullName', e.target.value)}
                  placeholder="Ayşe Yılmaz"
                  autoComplete="name"
                  aria-invalid={Boolean(errors.adminFullName)}
                />
              </Field>

              <Field
                id="adminEmail"
                label="E-posta"
                error={errors.adminEmail}
                hint="Parola belirleme bağlantısı bu adrese gönderilir."
              >
                <Input
                  id="adminEmail"
                  type="email"
                  value={values.adminEmail}
                  onChange={(e) => set('adminEmail', e.target.value)}
                  placeholder="ayse.yilmaz@acme.com.tr"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.adminEmail)}
                />
              </Field>
            </div>
          )}

          {/* -------------------------------- 3. Plan ------------------------------- */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Planı sonradan değiştirebilirsiniz. Çalışan sayınız kotayı aştığında yükseltme
                gerekir.
              </p>
              <div role="radiogroup" aria-label="Plan seçimi">
                <PricingPlans
                  mode="select"
                  value={values.plan}
                  onChange={(plan) => set('plan', plan)}
                />
              </div>
            </div>
          )}

          {/* -------------------------------- 4. Özet ------------------------------- */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Bilgileri gözden geçirin. Bir şeyi değiştirmek için ilgili adıma dönebilirsiniz.
              </p>

              <dl className="divide-y divide-border rounded-lg border border-border">
                {[
                  { label: 'Şirket adı', value: values.companyName, step: 0 as StepIndex },
                  { label: 'Kısa ad', value: values.slug, step: 0 as StepIndex, mono: true },
                  { label: 'Vergi numarası', value: values.taxNumber || '—', step: 0 as StepIndex },
                  {
                    label: 'E-posta alan adı',
                    value: values.emailDomain || '—',
                    step: 0 as StepIndex,
                  },
                  { label: 'Yönetici', value: values.adminFullName, step: 1 as StepIndex },
                  { label: 'Yönetici e-postası', value: values.adminEmail, step: 1 as StepIndex },
                  {
                    label: 'Plan',
                    value: `${tenantPlanLabels[values.plan]} — ${formatNumber(
                      planById(values.plan).maxEmployees,
                    )} çalışana kadar`,
                    step: 2 as StepIndex,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5"
                  >
                    <dt className="text-[13px] text-muted-foreground">{row.label}</dt>
                    <dd className="flex items-baseline gap-3">
                      <span className={cn('text-[13px] font-medium', row.mono && 'font-mono')}>
                        {row.value}
                      </span>
                      <button
                        type="button"
                        onClick={() => goToStep(row.step)}
                        className="cursor-pointer text-[12px] text-primary underline-offset-2 hover:underline"
                      >
                        Düzenle
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>

              {submitError && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3.5"
                >
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">{submitError.title}</p>
                    <p className="mt-1 text-[12px] leading-relaxed break-words text-muted-foreground">
                      {submitError.detail}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

            </motion.div>
          </AnimatePresence>

          {/* ------------------------------- Gezinme ------------------------------- */}
          <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                className="cursor-pointer"
                disabled={register.isPending}
                onClick={() => goToStep(Math.max(0, step - 1) as StepIndex)}
              >
                <ArrowLeft className="size-4" />
                Geri
              </Button>
            ) : (
              <Button type="button" variant="ghost" className="cursor-pointer" asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  Vazgeç
                </Link>
              </Button>
            )}

            {step < 3 ? (
              <Button type="button" className="cursor-pointer" onClick={goNext}>
                Devam
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button
                type="button"
                className="cursor-pointer"
                disabled={register.isPending}
                onClick={submit}
              >
                {register.isPending && <LoaderCircle className="size-4 animate-spin" />}
                {register.isPending ? 'Gönderiliyor' : 'Kaydı tamamla'}
              </Button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-[13px] text-muted-foreground">
          Şirketiniz zaten kayıtlı mı?{' '}
          <Link to="/giris" className="font-medium text-primary underline-offset-2 hover:underline">
            Giriş yapın
          </Link>
        </p>
      </div>
    </main>
  )
}
