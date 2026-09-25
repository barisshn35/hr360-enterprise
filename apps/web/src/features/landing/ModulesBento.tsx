import { motion, useReducedMotion } from 'motion/react'
import {
  BadgeDollarSign,
  Building2,
  CalendarDays,
  Check,
  FileText,
  GraduationCap,
  Inbox,
  Lock,
  ShieldCheck,
  Target,
  UserPlus,
} from 'lucide-react'
import { EASE, Reveal, Spotlight, Stagger, StaggerItem, useRevealed } from '@/motion/primitives'
import { cn } from '@/lib/utils'

/**
 * Modül vitrini — eşit kartlar yerine bento.
 *
 * Sebebi estetik değil hiyerarşi: onay akışı Staffware'ın merkezinde duruyor,
 * kart boyutu bunu söylüyor. Büyük hücre ayrıca modülün kendisinden küçük
 * bir örnek gösteriyor; "onay zinciri" lafı soyut kalmasın.
 */

type Cell = {
  id: string
  icon: React.ElementType
  title: string
  detail: string
  className: string
  /** Büyük hücre: içine modülden küçük bir örnek de girer. */
  feature?: boolean
  extraIcon?: React.ElementType
}

const CELLS: Cell[] = [
  {
    id: 'onay',
    icon: Inbox,
    title: 'Onay akışları',
    detail:
      'Çok adımlı zincirler, SLA takibi ve devretme. Sırası gelmeyen adım kilitli durur; kimse yanlış anda karar veremez.',
    className: 'lg:col-span-3 lg:row-span-2',
    feature: true,
  },
  {
    id: 'organizasyon',
    icon: Building2,
    title: 'Organizasyon ve çalışanlar',
    detail: 'Şirket, departman ağacı, pozisyon atamaları ve çalışan kayıtları tek yerde.',
    className: 'lg:col-span-3',
  },
  {
    id: 'izin',
    icon: CalendarDays,
    title: 'İzin ve puantaj',
    detail:
      'Hak ediş, bakiye, vardiya planı ve fazla mesai. Onaylanan talep bakiyeye kendiliğinden düşer.',
    className: 'lg:col-span-3',
  },
  {
    id: 'isealim',
    icon: UserPlus,
    title: 'İşe alım ve onboarding',
    detail: 'İlan, aday havuzu, başvuru hunisi; işe başlayanlar için görev planı ve zimmet.',
    className: 'lg:col-span-2',
  },
  {
    id: 'gelisim',
    icon: Target,
    title: 'Performans ve eğitim',
    detail: 'Değerlendirme dönemleri, ağırlıklı hedefler, zorunlu eğitim uyumu ve sertifikalar.',
    className: 'lg:col-span-2',
    extraIcon: GraduationCap,
  },
  {
    id: 'ucret',
    icon: BadgeDollarSign,
    title: 'Ücret ve bantlar',
    detail: 'Kademe bantları, ücret geçmişi ve bütçe etkisini önceden gösteren zam simülasyonu.',
    className: 'lg:col-span-2',
  },
  {
    id: 'vaka',
    icon: FileText,
    title: 'İK vakaları ve dokümanlar',
    detail:
      'Çalışandan gelen talep ve şikâyetler kayıt defterinde; çözüm metni kayda geçer, dosyalar çalışana bağlanır.',
    className: 'lg:col-span-3',
  },
  {
    id: 'roller',
    icon: ShieldCheck,
    title: 'Rol bazlı erişim',
    detail:
      'Çalışan, yönetici, İK ve platform yöneticisi için ayrı görünürlük. Yetkiniz yoksa modül menüde bile çıkmaz.',
    className: 'lg:col-span-3',
  },
]

/**
 * Büyük hücrenin içindeki mini onay zinciri.
 *
 * Zincirin görünürlüğü kendi gözlemcisiyle ölçülüyor: kart `Stagger` ile
 * açılırken zincir de kendi ritminde iniyor, ikisi birbirine karışmıyor.
 */
function MiniChain() {
  const reduced = useReducedMotion()
  const steps = [
    { name: 'Ayşe Demir', role: 'Yönetici', state: 'done' as const },
    { name: 'Mert Şahin', role: 'İK', state: 'live' as const },
    { name: 'Elif Kaya', role: 'Direktör', state: 'locked' as const },
  ]

  const [ref, revealed] = useRevealed<HTMLDivElement>(0.35)

  return (
    <div ref={ref} className="mt-6 rounded-lg border border-border bg-background/50 p-4">
      <ol className="space-y-0">
        {steps.map((step, i) => (
          <motion.li
            key={step.name}
            initial={reduced ? false : { opacity: 0, x: -8 }}
            animate={revealed || reduced ? { opacity: 1, x: 0 } : undefined}
            transition={{ duration: 0.5, delay: reduced ? 0 : 0.15 + i * 0.13, ease: EASE }}
            className="relative flex gap-3 pb-4 last:pb-0"
          >
            <div className="relative flex w-6 shrink-0 flex-col items-center">
              <span
                className={cn(
                  'tabular relative z-10 flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-bold',
                  step.state === 'done' &&
                    'border-[hsl(var(--success))] bg-[hsl(var(--success))] text-background',
                  step.state === 'live' && 'border-primary bg-primary text-primary-foreground',
                  step.state === 'locked' && 'border-border bg-background text-muted-foreground',
                )}
              >
                {step.state === 'done' ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : step.state === 'locked' ? (
                  <Lock className="size-2.5" />
                ) : (
                  i + 1
                )}
              </span>
              {step.state === 'live' && !reduced && (
                <span className="hr-ring absolute top-0 size-6 rounded-full border-2 border-primary" />
              )}
              {i < steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className={cn('w-px flex-1', step.state === 'done' ? 'bg-border' : 'bg-border/50')}
                />
              )}
            </div>

            <div className={cn('min-w-0 flex-1', step.state === 'locked' && 'opacity-55')}>
              <p className="text-[13px] font-medium">{step.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {step.state === 'done'
                  ? `${step.role} · onayladı`
                  : step.state === 'live'
                    ? `${step.role} · karar bekleniyor`
                    : `${step.role} · sırası gelmedi`}
              </p>
            </div>
          </motion.li>
        ))}
      </ol>
    </div>
  )
}

export function ModulesBento() {
  return (
    <section id="moduller" className="relative scroll-mt-24 px-5 py-20 md:py-28">
      <div className="mx-auto max-w-7xl">
        <Reveal className="mb-12 text-center">
          <p className="mb-3 text-[11px] font-semibold tracking-widest text-primary uppercase">
            Modüller
          </p>
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
            İK'nın gündelik işi, baştan sona
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Ayrı araçlar arasında veri taşımak yok. Bir modülde olan, diğerini kendiliğinden
            besliyor.
          </p>
        </Reveal>

        <Stagger className="grid auto-rows-[minmax(0,auto)] gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {CELLS.map((cell) => (
            <StaggerItem key={cell.id} className={cell.className}>
              <Spotlight className="group h-full overflow-hidden rounded-2xl border border-border bg-card p-6 transition-colors duration-300 hover:border-primary/40">
                <div className="relative flex h-full flex-col">
                  <div className="mb-4 flex items-center gap-2">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 transition-transform duration-300 group-hover:scale-110">
                      <cell.icon
                        aria-hidden="true"
                        className="size-5 text-primary"
                        strokeWidth={1.75}
                      />
                    </span>
                    {cell.extraIcon && (
                      <span className="flex size-10 items-center justify-center rounded-xl bg-[hsl(var(--chart-2))]/10 transition-transform delay-75 duration-300 group-hover:scale-110">
                        <cell.extraIcon
                          aria-hidden="true"
                          className="size-5 text-[hsl(var(--chart-2))]"
                          strokeWidth={1.75}
                        />
                      </span>
                    )}
                  </div>

                  <h3
                    className={cn(
                      'mb-2 font-semibold',
                      cell.feature ? 'text-[19px]' : 'text-[16px]',
                    )}
                  >
                    {cell.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground">
                    {cell.detail}
                  </p>

                  {cell.feature && <MiniChain />}
                </div>
              </Spotlight>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}
