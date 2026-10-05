import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Lock, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { usePlan, planLabels } from '@/lib/plan'
import { useAuth } from '@/auth/useAuth'
import { tx } from '@/lib/i18n'

/**
 * Kiracısız oturumda şirket düzeyindeki ekran yerine gösterilen kart (PlanGate ve TenantOnly ortak).
 * Platform yöneticisi hiçbir şirkete bağlı değildir ve "şirket değiştirme" yoktur: şirket verisini
 * Kiracılar ekranından yönetir. Başka bir kullanıcıda kiracı yoksa oturum eksik açılmıştır.
 */
export function NoTenantNotice() {
  const { roles } = useAuth()
  const platform = roles.includes('platform-admin')
  return (
    <Card className="mx-auto mt-10 max-w-lg items-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="size-5" /></span>
      <h2 className="text-[17px] font-semibold">{tx('Bu ekran şirket düzeyindedir')}</h2>
      {platform ? (
        <>
          <p className="text-[13.5px] text-muted-foreground">{tx('Platform yöneticisi hiçbir şirkete bağlı değildir; şirket verisini Kiracılar ekranından yönetir.')}</p>
          <Button asChild className="mt-2">
            <Link to="/panel/platform/kiracilar">{tx('Kiracılara git')}</Link>
          </Button>
        </>
      ) : (
        <p className="text-[13.5px] text-muted-foreground">{tx('Hesabınız bir şirkete bağlı görünmüyor. Çıkış yapıp yeniden giriş yapın; sorun sürerse yöneticinize başvurun.')}</p>
      )}
    </Card>
  )
}

/**
 * Planın dışında kalan modül için yükseltme kartı.
 * `allowPlatform`: kiracılar arası paylaşımlı ekranlar (ör. model kartı) platform yöneticisine
 * kiracı şartı olmadan açılır.
 */
export function PlanGate({ feature, allowPlatform = false, children }: { feature: string; allowPlatform?: boolean; children: ReactNode }) {
  const { hasFeature, requiredPlan, plan, noTenant, billingEnabled, isLoading } = usePlan()
  const { roles } = useAuth()
  if (feature === 'billing') {
    if (billingEnabled) return <>{children}</>
    if (isLoading) return null
    return (
      <Card className="mx-auto mt-10 max-w-lg items-center gap-3 p-8 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Lock className="size-5" /></span>
        <h2 className="text-[17px] font-semibold">{tx('Faturalandırma kapalı')}</h2>
        <p className="text-[13.5px] text-muted-foreground">{tx('HR360 açık kaynak olarak kuruldu; abonelik ve fatura modülü kullanılmıyor. Açmak için sunucuda')}{' '}<code className="font-mono text-[12px]">{tx('BILLING_ENABLED=true')}</code>{' '}{tx('ayarlanır.')}</p>
      </Card>
    )
  }
  if (noTenant) {
    if (allowPlatform && roles.includes('platform-admin')) return <>{children}</>
    return <NoTenantNotice />
  }
  if (hasFeature(feature)) return <>{children}</>
  const need = requiredPlan(feature)
  return (
    <Card className="mx-auto mt-10 max-w-lg items-center gap-3 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Lock className="size-5" />
      </span>
      <h2 className="text-[17px] font-semibold">{tx('Bu modül {0} planda', [need ? planLabels[need] : tx('üst')])}</h2>
      <p className="text-[13.5px] text-muted-foreground">
        {tx('Şirketinizin planı:')}{' '}<b>{plan ? planLabels[plan] : '—'}</b>{tx('. Planı yükselterek bu özelliği açabilirsiniz.')}
      </p>
      <Button asChild className="mt-2">
        <Link to="/panel/abonelik">
          <Sparkles className="size-4" />{' '}{tx('Planları gör')}
        </Link>
      </Button>
    </Card>
  )
}

