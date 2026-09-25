import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAuth } from './useAuth'
import { primaryRole, roleLabels, hasStandardRole, type Permission, type Role } from './roles'

/**
 * Yetkisiz erişimde boş sayfa yerine ne olduğunu ve ne yapılacağını söyler.
 *
 * `requireRoles` verilirse, `permission` (Ek İzin dahil) yerine SADECE bu
 * sabit rollerden birine sahip olup olmadığı kontrol edilir - bkz.
 * hasStandardRole'daki not: bazı ekranların arkasındaki backend uçları
 * "ext-*" ile genişletilmemiş, o yüzden Ek İzin ile buraya girip veri
 * çekememe durumunu önceden engeller.
 */
export function RequirePermission({
  permission,
  requireRoles,
  children,
}: {
  permission: Permission
  requireRoles?: Role[]
  children: ReactNode
}) {
  const { can, roles } = useAuth()
  const allowed = requireRoles ? hasStandardRole(roles, requireRoles) : can(permission)
  if (allowed) return <>{children}</>

  return (
    <div role="alert" className="py-20">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <span className="mb-4 flex size-11 items-center justify-center rounded-full bg-muted">
          <ShieldOff aria-hidden="true" className="size-5 text-muted-foreground" strokeWidth={1.5} />
        </span>
        <h1 className="text-[22px] leading-tight font-semibold">Bu bölüme erişiminiz yok</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
          Rolünüz ({roleLabels[primaryRole(roles)]}) bu sayfayı kapsamıyor. Erişim gerekiyorsa
          İK yöneticinizden rol talep edin.
        </p>
        <Button asChild className="mt-6">
          <Link to="/panel">Genel bakışa dön</Link>
        </Button>
      </div>
    </div>
  )
}
