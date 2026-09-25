import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Magnetic, Reveal } from '@/motion/primitives'

export function CtaBand() {
  return (
    <section className="px-5 pb-20 md:pb-28">
      <Reveal>
        <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border bg-card px-6 py-16 text-center sm:px-12">
          {/* Dönen konik kenarlık; içerik kendi zemininde ayrı katmanda. */}
          <div aria-hidden="true" className="hr-conic-border absolute inset-0" />
          <div aria-hidden="true" className="absolute inset-px rounded-[calc(1.5rem-1px)] bg-card" />
          <div
            aria-hidden="true"
            className="hr-aurora absolute -bottom-32 left-1/2 size-[28rem] -translate-x-1/2 rounded-full bg-primary/20 blur-[100px]"
          />

          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.12]">
              Şirketinizi bugün kaydedin,
              <span className="block bg-gradient-to-b from-foreground to-foreground/50 bg-clip-text text-transparent">
                ekibiniz yarın kullanmaya başlasın.
              </span>
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
              Kurulum birkaç dakika sürer. Kredi kartı istenmez, kurulum ücreti yoktur.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Magnetic>
                <Button size="lg" className="hr-sheen h-12 cursor-pointer px-7 text-[15px]" asChild>
                  <Link to="/kayit">
                    Şirketinizi kaydedin
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </Magnetic>
              <Button size="lg" variant="ghost" className="h-12 cursor-pointer px-7" asChild>
                <Link to="/giris">Zaten hesabım var</Link>
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
