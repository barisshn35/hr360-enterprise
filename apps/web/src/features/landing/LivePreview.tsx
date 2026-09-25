/**
 * Landing'deki ürün önizlemesi — canlı.
 *
 * 21st şablonu burada CDN'den iki PNG çekiyordu. Onun yerine panelin kendi
 * bileşen diliyle çizilmiş, çalışan bir minyatür duruyor: harici istek yok,
 * tema değişince önizleme de değişiyor, ekran güncellenince görsel bayatlamıyor.
 *
 * Hareketin işi süslemek değil ANLATMAK: birkaç saniyede bir en üstteki talep
 * onaylanıyor, rozet yeşile dönüyor, "Bekleyen onay" bir azalıyor ve "Bu ay
 * izin" bir artıyor. Staffware'ın asıl farkı olan Kafka otomasyonu — onay verilince
 * izin ve bakiyenin kendiliğinden güncellenmesi — tek bir cümle okumadan
 * gösteriliyor.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bell, CalendarDays, Check, Inbox, LayoutDashboard, Search, Users } from 'lucide-react'
import { CountUp, EASE, useParallax } from '@/motion/primitives'
import { cn } from '@/lib/utils'

const NAV = [
  { icon: LayoutDashboard, label: 'Genel bakış', active: true },
  { icon: Inbox, label: 'Onay kutusu', badge: true },
  { icon: CalendarDays, label: 'İzin' },
  { icon: Users, label: 'Çalışanlar' },
]

type Row = {
  id: string
  name: string
  meta: string
  state: 'pending' | 'approved'
}

const INITIAL_ROWS: Row[] = [
  { id: 'r1', name: 'Yıllık izin talebi', meta: 'Ayşe Demir · 3 gün', state: 'pending' },
  { id: 'r2', name: 'Masraf beyanı', meta: 'Kerem Yıldız · ₺2.480', state: 'approved' },
  { id: 'r3', name: 'Pozisyon değişikliği', meta: 'Deniz Arslan', state: 'pending' },
  { id: 'r4', name: 'Zimmet talebi', meta: 'Elif Kaya · Dizüstü', state: 'approved' },
]

/** Sırayla onaylanacak talepler — döngü başa sarınca liste tazelenir. */
const QUEUE: Row[] = [
  { id: 'r5', name: 'Eğitim kaydı', meta: 'Mert Şahin · 8 saat', state: 'pending' },
  { id: 'r6', name: 'Fazla mesai onayı', meta: 'Zeynep Ak · 6s 30dk', state: 'pending' },
  { id: 'r7', name: 'Yıllık izin talebi', meta: 'Burak Tan · 5 gün', state: 'pending' },
]

export function LivePreview() {
  const reduced = useReducedMotion()
  const { ref, y } = useParallax(38)

  const [rows, setRows] = useState<Row[]>(INITIAL_ROWS)
  const [pending, setPending] = useState(7)
  const [leave, setLeave] = useState(31)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (reduced) return

    // Adım 1: en üstteki bekleyen talep onaylanır.
    // Adım 2: sayaçlar kayar ve kuyruktan yeni bir talep en üste düşer.
    const id = window.setInterval(() => {
      setRows((prev) => {
        const firstPending = prev.findIndex((r) => r.state === 'pending')
        if (firstPending >= 0) {
          const next = [...prev]
          next[firstPending] = { ...next[firstPending], state: 'approved' }
          return next
        }
        // Hepsi onaylandıysa kuyruktan tazele.
        const fresh = QUEUE[tick % QUEUE.length]
        return [{ ...fresh, id: `${fresh.id}-${tick}` }, ...prev.slice(0, 3)]
      })

      setPending((p) => (p <= 3 ? 7 : p - 1))
      setLeave((l) => (l >= 36 ? 31 : l + 1))
      setTick((t) => t + 1)
    }, 2600)

    return () => window.clearInterval(id)
  }, [reduced, tick])

  return (
    <motion.div ref={ref} style={{ y }} className="relative">
      {/* Ekranın altındaki yansıma/ışık — kartı zeminden ayırır. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-8 -bottom-6 h-24 rounded-[50%] bg-primary/25 blur-3xl"
      />

      <div
        aria-label="Staffware panel önizlemesi"
        role="img"
        className="relative overflow-hidden rounded-xl border border-border bg-card shadow-[0_30px_80px_-40px_hsl(var(--foreground)/0.45)]"
      >
        <div className="flex">
          {/* ------------------------------ Kenar çubuğu ----------------------------- */}
          <div className="hidden w-44 shrink-0 flex-col gap-0.5 border-r border-sidebar-border bg-sidebar p-2.5 sm:flex">
            <div className="mb-3 flex items-center gap-2 px-1 py-1">
              <span className="flex size-6 items-center justify-center rounded bg-primary text-[10px] font-semibold text-primary-foreground">
                A
              </span>
              <span className="flex flex-col leading-none">
                <span className="text-[11px] font-medium">Acme Holding</span>
                <span className="mt-0.5 text-[9px] text-muted-foreground">Kurumsal</span>
              </span>
            </div>

            {NAV.map((item) => (
              <div
                key={item.label}
                className={cn(
                  'relative flex items-center gap-2 rounded px-2 py-1.5 text-[11px]',
                  item.active ? 'font-medium text-primary' : 'text-muted-foreground',
                )}
              >
                {item.active && (
                  <motion.span
                    layoutId="preview-nav"
                    className="absolute inset-0 rounded bg-primary/10"
                    transition={{ duration: 0.4, ease: EASE }}
                  />
                )}
                <item.icon className="relative size-3.5" strokeWidth={1.5} />
                <span className="relative truncate">{item.label}</span>
                {item.badge && (
                  <motion.span
                    key={pending}
                    initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className="tabular relative ml-auto rounded-full bg-primary/15 px-1.5 text-[9px] font-medium text-primary"
                  >
                    {pending}
                  </motion.span>
                )}
              </div>
            ))}
          </div>

          {/* --------------------------------- İçerik -------------------------------- */}
          <div className="min-w-0 flex-1">
            <div className="flex h-10 items-center gap-2 border-b border-border px-3">
              <span className="text-[11px] font-semibold">Genel bakış</span>
              <div className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                <Search className="size-3.5" strokeWidth={1.5} />
                <span className="relative">
                  <Bell className="size-3.5" strokeWidth={1.5} />
                  <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
                </span>
                <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
                  AY
                </span>
              </div>
            </div>

            <div className="space-y-3 p-3">
              <div className="grid grid-cols-3 gap-2">
                <StatTile label="Çalışan" value={248} />
                <StatTile label="Bekleyen onay" value={pending} live />
                <StatTile label="Bu ay izin" value={leave} />
              </div>

              <div className="overflow-hidden rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-2.5 py-1.5">
                  <span className="text-[9px] font-semibold tracking-wider text-muted-foreground uppercase">
                    Son talepler
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
                    <span className="relative flex size-1.5">
                      <span className="absolute inset-0 rounded-full bg-[hsl(var(--success))]" />
                      {!reduced && (
                        <span className="hr-ring absolute inset-0 rounded-full bg-[hsl(var(--success))]" />
                      )}
                    </span>
                    canlı
                  </span>
                </div>

                <ul className="min-h-[140px]">
                  <AnimatePresence initial={false} mode="popLayout">
                    {rows.map((row) => (
                      <motion.li
                        key={row.id}
                        layout={!reduced}
                        initial={reduced ? false : { opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, height: 0 }}
                        transition={{ duration: 0.45, ease: EASE }}
                        className="flex items-center gap-2 border-b border-border px-2.5 py-2 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-medium">{row.name}</p>
                          <p className="truncate text-[9px] text-muted-foreground">{row.meta}</p>
                        </div>
                        <StateBadge state={row.state} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

function StatTile({ label, value, live }: { label: string; value: number; live?: boolean }) {
  const reduced = useReducedMotion()

  return (
    <div className="relative overflow-hidden rounded-md border border-border p-2.5">
      <p className="text-[9px] text-muted-foreground">{label}</p>
      {live ? (
        <motion.p
          key={value}
          initial={reduced ? false : { y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="tabular mt-1 text-lg leading-none font-semibold"
        >
          {value}
        </motion.p>
      ) : (
        <CountUp to={value} duration={1.8} className="mt-1 block text-lg leading-none font-semibold" />
      )}
    </div>
  )
}

function StateBadge({ state }: { state: Row['state'] }) {
  const reduced = useReducedMotion()
  const approved = state === 'approved'

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state}
        initial={reduced ? false : { scale: 0.82, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={reduced ? undefined : { scale: 0.82, opacity: 0 }}
        transition={{ duration: 0.28, ease: EASE }}
        className={cn(
          'flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium',
          approved
            ? 'bg-[hsl(var(--success))]/15 text-[hsl(var(--success))]'
            : 'bg-[hsl(var(--warning))]/15 text-[hsl(var(--warning))]',
        )}
      >
        {approved && <Check className="size-2.5" strokeWidth={3} />}
        {approved ? 'Onaylandı' : 'Bekliyor'}
      </motion.span>
    </AnimatePresence>
  )
}
