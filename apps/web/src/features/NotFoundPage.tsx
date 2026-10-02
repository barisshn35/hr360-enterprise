import { Link } from 'react-router-dom'
import { Compass, Map, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/States'
import { tx } from '@/lib/i18n'

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center pt-10">
      <p
        aria-hidden="true"
        className="text-gradient text-[96px] leading-none font-semibold tracking-[-0.06em] opacity-80 select-none sm:text-[128px]"
      >
        404
      </p>
      <EmptyState
        className="w-full pt-4"
        icons={[Map, Compass, SearchX]}
        title={tx('Sayfa bulunamadı')}
        detail={tx('Aradığınız adres taşınmış ya da hiç var olmamış olabilir.')}
        action={
          <Button asChild>
            <Link to="/panel">{tx('Genel bakışa dön')}</Link>
          </Button>
        }
      />
    </div>
  )
}
