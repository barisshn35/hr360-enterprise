import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Plus } from 'lucide-react'
import { EASE, Reveal } from '@/motion/primitives'
import { cn } from '@/lib/utils'

/**
 * Sorular gerçek: kurulum sırasında en çok sorulanlar ve ürünün gerçekten
 * yaptığı şeyler. Yapmadığımız bir şeyi vaat eden cevap yok.
 */
const ITEMS = [
  {
    q: 'Verilerimiz başka şirketlerin verisiyle karışır mı?',
    a: 'Hayır. Her şirket ayrı bir kiracı. Oturum açtığınızda kimlik sunucusu jetonunuza şirketinizin işaretini koyuyor ve backend her sorguyu bu işarete göre süzüyor. İşaret olmadan bir istek hiçbir kayıt döndürmez — yanlış şirketin verisini görmek teknik olarak mümkün değil.',
  },
  {
    q: 'Kendi kimlik sağlayıcımızla giriş yapabilir miyiz?',
    a: 'Evet. Kimlik doğrulama Keycloak üzerinden yürüyor (Authorization Code + PKCE) ve parola Staffware arayüzüne hiçbir zaman girilmiyor. Kurumsal dizininizi Keycloak’a federe ederseniz ekibiniz mevcut hesabıyla giriş yapar.',
  },
  {
    q: 'Bir yönetici onay verdiğinde ne oluyor?',
    a: 'Karar bir olay olarak yayınlanıyor. İzin talebi sonuçlanıyor, bakiye güncelleniyor ve talep sahibine bildirim gidiyor — üçü de kendiliğinden. Bu yüzden izin ekranında ikinci bir "onayla" düğmesi yok; olsaydı aynı işi iki kez yapmış olurduk.',
  },
  {
    q: 'Herkes her şeyi görüyor mu?',
    a: 'Hayır. Altı rol katmanı ve otuz altı ayrı izin var. Yetkiniz olmayan modül menüde bile görünmüyor. Arayüzdeki gizleme yalnızca ilk katman; her istek sunucu tarafında yeniden denetleniyor.',
  },
  {
    q: 'Planı sonradan değiştirebilir miyiz?',
    a: 'Evet. Planlar çalışan kotasına göre ayrışıyor; çalışan sayınız kotayı aştığında yükseltme gerekiyor. Plan değişikliği veri kaybına yol açmaz.',
  },
  {
    q: 'Mevcut çalışan verimizi nasıl taşırız?',
    a: 'Çalışan, departman ve atama kayıtları arayüzden girilebiliyor; aynı kayıtlar servis uçlarından da yazılabildiği için toplu aktarım mümkün. Her listeden CSV dışa aktarma var, geri alma tarafı için uçları kullanıyoruz.',
  },
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  const reduced = useReducedMotion()

  return (
    <section id="sorular" className="relative scroll-mt-24 px-5 py-20 md:py-28">
      <div className="mx-auto max-w-3xl">
        <Reveal className="mb-12 text-center">
          <p className="mb-3 text-[11px] font-semibold tracking-widest text-primary uppercase">
            Sorular
          </p>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-[42px] sm:leading-[1.1]">
            Merak edilenler
          </h2>
        </Reveal>

        <Reveal delay={0.1}>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {ITEMS.map((item, i) => {
              const isOpen = open === i
              return (
                <li key={item.q}>
                  <h3>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : i)}
                      aria-expanded={isOpen}
                      className="flex w-full cursor-pointer items-start justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-accent/40"
                    >
                      <span
                        className={cn(
                          'text-[15px] font-medium transition-colors',
                          isOpen && 'text-primary',
                        )}
                      >
                        {item.q}
                      </span>
                      <motion.span
                        aria-hidden="true"
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.28, ease: EASE }}
                        className={cn(
                          'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors',
                          isOpen
                            ? 'border-primary/40 bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        <Plus className="size-3.5" strokeWidth={2.5} />
                      </motion.span>
                    </button>
                  </h3>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={reduced ? false : { height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={reduced ? undefined : { height: 0, opacity: 0 }}
                        transition={{ duration: 0.34, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <p className="px-5 pb-5 text-[14px] leading-relaxed text-muted-foreground">
                          {item.a}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              )
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  )
}
