import { useMemo } from 'react'
import { useAuth } from '@/auth/useAuth'
import { usePlan } from '@/lib/plan'
import { filterByPermission, navGroups } from './nav-config'

/** Kullanıcının izinleri ve şirketin planıyla süzülmüş menü ağacı. */
export function useNavGroups() {
  const { can, roles } = useAuth()
  const { hasFeature, plan, enforced, billingEnabled } = usePlan()
  // hasFeature her render'da yeni; bağımlılık olarak planın kendisi yeterli.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => filterByPermission(navGroups, can, roles, hasFeature), [can, roles, plan, enforced, billingEnabled])
}
