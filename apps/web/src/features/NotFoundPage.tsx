import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/States'

export function NotFoundPage() {
  return (
    <EmptyState
      icon={Compass}
      title="Sayfa bulunamadı"
      detail="Aradığınız adres taşınmış ya da hiç var olmamış olabilir."
      action={
        <Button asChild>
          <Link to="/panel">Genel bakışa dön</Link>
        </Button>
      }
    />
  )
}
