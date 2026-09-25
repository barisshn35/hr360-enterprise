import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EASE, Magnetic } from '@/motion/primitives'
import { cn } from '@/lib/utils'

export const SECTIONS = [
  { id: 'moduller', label: 'Modüller' },
  { id: 'otomasyon', label: 'Otomasyon' },
  { id: 'nasil-calisir', label: 'Nasıl çalışır' },
  { id: 'planlar', label: 'Planlar' },
  { id: 'sorular', label: 'Sorular' },
]

/**
 * Sabit navigasyon.
 *
 * İki davranış: sayfa kaydıkça daralıp bulanıklaşır (içerik öne çıksın), ve
 * hangi bölümdeysen o başlığın altında kayan bir gösterge durur. Gösterge
 * `layoutId` ile taşınıyor — bölümler arası geçiş sıçramıyor.
 */
export function LandingNav() {
  const { scrollY } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [active, setActive] = useState<string>('')

  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 24))

  // Görünürdeki bölümü izle — navigasyon nerede olduğunu göstersin.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible) setActive(visible.target.id)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] },
    )
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div
        className={cn(
          'mx-auto transition-all duration-500 ease-out',
          scrolled
            ? 'mt-2 max-w-5xl rounded-full border border-border bg-background/70 px-4 py-2 shadow-lg shadow-foreground/5 backdrop-blur-xl'
            : 'mt-0 max-w-7xl border-b border-transparent px-5 py-4',
        )}
      >
        <nav className="flex items-center justify-between gap-4">
          <Link
            to="/"
            className="flex shrink-0 items-center gap-2 text-[17px] font-semibold tracking-tight"
          >
            <img
              src="/icon-emerald.svg"
              alt=""
              aria-hidden="true"
              className="size-7 shrink-0"
            />
            Staffware
          </Link>

          <div className="hidden items-center gap-1 md:flex">
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={cn(
                  'relative rounded-full px-3 py-1.5 text-sm transition-colors',
                  active === section.id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {active === section.id && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 rounded-full bg-accent"
                    transition={{ duration: 0.45, ease: EASE }}
                  />
                )}
                <span className="relative">{section.label}</span>
              </a>
            ))}
          </div>

          <div className="hidden shrink-0 items-center gap-2 md:flex">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/giris">Giriş yap</Link>
            </Button>
            <Magnetic strength={0.2}>
              <Button size="sm" className="hr-sheen cursor-pointer" asChild>
                <Link to="/kayit">
                  Şirketinizi kaydedin
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </Magnetic>
          </div>

          <button
            type="button"
            className="cursor-pointer text-foreground md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          >
            {menuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
          </button>
        </nav>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="mx-3 mt-2 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur-xl md:hidden"
          >
            <div className="flex flex-col gap-1">
              {SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {section.label}
                </a>
              ))}
              <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                <Button variant="outline" size="sm" asChild>
                  <Link to="/giris">Giriş yap</Link>
                </Button>
                <Button size="sm" asChild>
                  <Link to="/kayit">Şirketinizi kaydedin</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  )
}
