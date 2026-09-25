import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Bell, CalendarCheck, Check, Radio, Wallet } from 'lucide-react'
import { EASE, Reveal, useRevealed } from '@/motion/primitives'
import { cn } from '@/lib/utils'

/**
 * Staffware'ın asıl farkı: onay verildikten sonra kimsenin ikinci bir ekranda
 * "uygula" demesi gerekmiyor. Backend olay güdümlü; onay Kafka'ya düşüyor,
 * izin talebi sonuçlanıyor, bakiye güncelleniyor ve bildirim gidiyor.
 *
 * Bunu paragrafla anlatmak yerine akışın kendisini oynatıyoruz. Döngü,
 * "bu sürekli oluyor" hissini veriyor; hareket kapalıysa tüm adımlar
 * tamamlanmış hâlde duruyor ve metin aynı bilgiyi taşıyor.
 */

const OUTCOMES = [
  {
    icon: CalendarCheck,
    title: 'İzin talebi sonuçlanır',
    detail: 'Talebin durumu Onaylandı olur, çalışan takviminde görünür.',
  },
  {
    icon: Wallet,
    title: 'Bakiye güncellenir',
    detail: 'Kullanılan gün düşer, kalan bakiye anında doğru rakamı gösterir.',
  },
  {
    icon: Bell,
    title: 'Bildirim gider',
    detail: 'Talep sahibi sonucu öğrenir; kimsenin haber vermesi gerekmez.',
  },
]

/** 0: bekliyor · 1: onaylandı · 2: olay yayında · 3+: sonuçlar sırayla iner */
const STAGES = 6
const STAGE_MS = 780

export function AutomationFlow() {
  const reduced = useReducedMotion()
  const [ref, inView] = useRevealed<HTMLDivElement>(0.3, false)
  const [stage, setStage] = useState(reduced ? STAGES : 0)

  useEffect(() => {
    if (reduced) {
      setStage(STAGES)
      return
    }
    if (!inView) return
    const id = window.setInterval(() => {
      setStage((s) => (s >= STAGES + 2 ? 0 : s + 1))
    }, STAGE_MS)
    return () => window.clearInterval(id)
  }, [inView, reduced])

  const approved = stage >= 1
  const broadcasting = stage >= 2
  const done = (index: number) => stage >= 3 + index

  return (
    <section
      id="otomasyon"
      className="relative scroll-mt-24 overflow-hidden border-y border-border bg-muted/30 px-5 py-20 md:py-28"
    >
      <div aria-hidden="true" className="hr-grid pointer-events-none absolute inset-0" />

      <div ref={ref} className="relative mx-auto max-w-6xl">
        <Reveal className="mb-14 text-center">
          <p className="mb-3 text-[11px] font-semibold tracking-widest text-primary uppercase">
            Otomasyon
          </p>
          <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
            Onay verildi. Gerisi kendiliğinden oldu.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            Servisler birbirini olaylarla dinliyor. Bir yöneticinin tek kararı, üç ayrı modülde
            karşılığını buluyor — ikinci bir ekran, ikinci bir tıklama yok.
          </p>
        </Reveal>

        <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.15fr)]">
          {/* ------------------------------- 1. Karar ------------------------------- */}
          <Reveal from="left">
            <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
              <p className="mb-4 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                Onay kutusu
              </p>

              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[13px] font-semibold text-primary">
                  AD
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">Yıllık izin talebi</p>
                  <p className="truncate text-[12px] text-muted-foreground">Ayşe Demir · 3 gün</p>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-2">
                <motion.div
                  animate={
                    reduced || !approved
                      ? {}
                      : { scale: [1, 0.95, 1], transition: { duration: 0.34, ease: EASE } }
                  }
                  className={cn(
                    'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors duration-300',
                    approved
                      ? 'bg-[hsl(var(--success))] text-background'
                      : 'bg-primary text-primary-foreground',
                  )}
                >
                  {approved ? (
                    <>
                      <Check className="size-4" strokeWidth={3} />
                      Onaylandı
                    </>
                  ) : (
                    'Onayla'
                  )}
                </motion.div>
                <div className="h-9 flex-1 rounded-md border border-border" />
              </div>
            </div>
          </Reveal>

          {/* ----------------------------- 2. Olay yayını ---------------------------- */}
          <div className="flex flex-col items-center justify-center gap-3 py-2">
            <Connector active={broadcasting} vertical />
            <div
              className={cn(
                'relative flex items-center gap-2 rounded-full border px-4 py-2 transition-colors duration-300',
                broadcasting
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground',
              )}
            >
              {broadcasting && !reduced && (
                <span className="hr-ring absolute inset-0 rounded-full border border-primary" />
              )}
              <Radio className="size-4" strokeWidth={1.75} />
              <span className="text-[12px] font-medium whitespace-nowrap">Olay yayını</span>
            </div>
            <Connector active={stage >= 3} vertical />
          </div>

          {/* ------------------------------- 3. Sonuçlar ------------------------------ */}
          <Reveal from="right">
            <ul className="space-y-3">
              {OUTCOMES.map((outcome, i) => (
                <li
                  key={outcome.title}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border bg-card p-4 transition-all duration-500',
                    done(i)
                      ? 'border-[hsl(var(--success))]/40 shadow-sm'
                      : 'border-border opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-500',
                      done(i)
                        ? 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {done(i) ? (
                      <motion.span
                        initial={reduced ? false : { scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.3, ease: EASE }}
                      >
                        <Check className="size-4.5" strokeWidth={3} />
                      </motion.span>
                    ) : (
                      <outcome.icon className="size-4.5" strokeWidth={1.75} />
                    )}
                  </span>

                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{outcome.title}</p>
                    <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                      {outcome.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>

        <Reveal delay={0.15}>
          <p className="mx-auto mt-10 max-w-2xl rounded-xl border border-border bg-card/60 px-5 py-4 text-center text-[13px] leading-relaxed text-muted-foreground backdrop-blur-sm">
            <strong className="font-semibold text-foreground">
              Bu yüzden izin ekranında "onayla" düğmesi yok.
            </strong>{' '}
            Karar tek yerde veriliyor; arayüz aynı işi ikinci kez yapmıyor, yapamıyor da.
          </p>
        </Reveal>
      </div>
    </section>
  )
}

/** Aşama ilerledikçe dolan bağlantı çizgisi. */
function Connector({ active, vertical }: { active: boolean; vertical?: boolean }) {
  const reduced = useReducedMotion()

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative overflow-hidden rounded-full bg-border',
        vertical ? 'h-10 w-px lg:h-px lg:w-16' : 'h-px w-16',
      )}
    >
      <motion.span
        className="absolute inset-0 origin-top rounded-full bg-primary lg:origin-left"
        initial={false}
        animate={
          reduced
            ? { scaleY: 1, scaleX: 1 }
            : { scaleY: active ? 1 : 0, scaleX: active ? 1 : 0 }
        }
        transition={{ duration: 0.45, ease: EASE }}
        style={{ transformOrigin: 'top left' }}
      />
    </span>
  )
}
