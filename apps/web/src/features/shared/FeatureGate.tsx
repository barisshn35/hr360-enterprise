import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePlan, planLabels } from '@/lib/plan'

/** Planın dışında kalan modül için yükseltme kartı. */
export function PlanGate({ feature, children }: { feature: string; children: ReactNode }) {
  const { hasFeature, requiredPlan, plan, noTenant } = usePlan()
  if (noTenant)
    return (
      <Card className="mx-auto mt-10 max-w-lg items-center gap-3 p-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Lock className="size-5" /></span>
        <h2 className="text-[17px] font-semibold">Önce bir şirket seçin</h2>
        <p className="text-[13.5px] text-muted-foreground">Bu modül şirket verisiyle çalışır. Sağ üstteki hesap menüsünden “Şirket değiştir” ile bir kiracı seçin.</p>
      </Card>
    )
  if (hasFeature(feature)) return <>{children}</>
  const need = requiredPlan(feature)
  return (
    <Card className="mx-auto mt-10 max-w-lg items-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Lock className="size-5" />
      </span>
      <h2 className="text-[17px] font-semibold">Bu modül {need ? planLabels[need] : 'üst'} planda</h2>
      <p className="text-[13.5px] text-muted-foreground">
        Şirketinizin planı: <b>{plan ? planLabels[plan] : '—'}</b>. Planı yükselterek bu özelliği açabilirsiniz.
      </p>
      <Button asChild className="mt-2">
        <Link to="/panel/abonelik">
          <Sparkles className="size-4" /> Planları gör
        </Link>
      </Button>
    </Card>
  )
}

