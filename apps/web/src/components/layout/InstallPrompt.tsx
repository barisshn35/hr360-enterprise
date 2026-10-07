import { useState } from 'react'
import { Download, Share, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { dismissInstall, isIos, isStandalone, readInstallDismissed, shouldOfferInstall, useInstallPrompt } from '@/lib/pwa'
import { tx } from '@/lib/i18n'

/**
 * Dalga 12 (madde 85): "uygulamayı yükle" önerisi. Tarayıcı yükleme sunuyorsa (Chrome/Edge/Android)
 * tek düğme; iPhone/iPad Safari'de "Paylaş › Ana Ekrana Ekle" yönergesi. "Daha sonra" 30 gün susturur.
 * Sayfa akışında durur (sabit konumlu değil): içerik ve rıhtım düğmelerinin üstünü kapatmaz.
 */
export function InstallPrompt() {
  const install = useInstallPrompt()
  const [dismissed, setDismissed] = useState(() => readInstallDismissed())
  const mode = shouldOfferInstall({ hasPrompt: Boolean(install), ios: isIos(), standalone: isStandalone(), dismissedAt: dismissed, now: Date.now() })
  if (!mode) return null
  const later = () => {
    const now = Date.now()
    dismissInstall(now)
    setDismissed(now)
  }
  return (
    <div className="mx-auto mt-3 w-full max-w-[1480px] px-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3 text-[13px]">
        {mode === 'prompt' ? <Download className="size-4 text-primary" /> : <Share className="size-4 text-primary" />}
        <p className="min-w-0 flex-1">
          {mode === 'prompt'
            ? tx('HR360\'ı ana ekranınıza ekleyin: tek dokunuşla açılır, bildirimler gelir, bağlantı koptuğunda izin ve masraf taslaklarınız saklanır.')
            : tx('HR360\'ı ana ekrana eklemek için Safari\'de Paylaş düğmesine, ardından "Ana Ekrana Ekle"ye dokunun. Anlık bildirimler iOS 16.4 ve sonrasında yalnızca ana ekrandan açılan uygulamada çalışır.')}
        </p>
        {mode === 'prompt' && install && (
          <Button size="sm" onClick={() => void install()}>{tx('Yükle')}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={later} aria-label={tx('Yükleme önerisini kapat')}>
          <X className="size-4" />
          {tx('Daha sonra')}
        </Button>
      </div>
    </div>
  )
}
