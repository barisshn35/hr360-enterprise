import { Languages } from 'lucide-react'
import { lang, setLanguage, tx } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/** Türkçe ↔ İngilizce. Seçim tarayıcıda saklanır; sayfa yeniden yüklenir. */
export function LanguageToggle({ className }: { className?: string }) {
  const next = lang === 'tr' ? 'en' : 'tr'
  return (
    <button
      type="button"
      onClick={() => setLanguage(next)}
      aria-label={next === 'en' ? tx('Switch to English') : tx('Türkçeye geç')}
      title={tx('Dil')}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <Languages className="size-4" strokeWidth={1.75} />
      {next.toUpperCase()}
    </button>
  )
}
