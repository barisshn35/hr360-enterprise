import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Info, Mail, Plus, ShieldAlert, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataTable, type Column } from '@/components/ui/DataTable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SelectField } from '@/components/ui/Field'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/auth/useAuth'
import { useCompanies, useDepartmentList } from '@/api/queries'
import { tenantApi } from '@/api/tenant'
import { permissionsFor, roleLabels, type Permission, type Role } from '@/auth/roles'

/**
 * Bu sayfadan atanabilecek roller - platform-admin platform seviyesinde,
 * buradan asla atanmaz/kaldırılmaz (bkz. eski TeamRolesPanel).
 */
const ASSIGNABLE_ROLES: Role[] = ['employee', 'manager', 'accounting', 'hr-admin', 'tenant-admin']

/**
 * Her rolün ne işe yaradığını tek cümleyle anlatır - tooltip içeriği.
 * roles.ts'teki Permission kodları (örn. "leave:manageBalance") burada
 * kod olarak değil, çalışanın anlayacağı dilde özetleniyor.
 */
const ROLE_SUMMARY: Partial<Record<Role, string>> = {
  employee: 'Kendi izin/masraf talebini açar, kendi puantajını ve eğitimlerini görür.',
  manager: 'Onay kutusunda karar verir, ekip kurar, performans ve onboarding sürecini yönetir.',
  accounting: 'Masraf beyanlarını görür ve onaylananları ödendi işaretler.',
  'hr-admin': 'Çalışan kayıtlarını, ücret bantlarını, izin bakiyelerini ve ilan yayınını yönetir.',
  'tenant-admin': 'Şirket ayarlarının sahibi; İK yönetiminin tüm yetkilerini de devralır.',
}

/**
 * roles.ts'teki Permission union'ındaki her koda kısa bir Türkçe açıklama -
 * "Ek izin" seçicisinde kod yerine bunlar gösterilir. Backend tarafında bu
 * iznin gerçekten hangi işlemleri açtığı, sadece EK_IZIN_BACKEND_DESTEGI'nde
 * listelenen servislerde uygulanmış durumda (bkz. aşağı).
 */
const PERMISSION_LABELS: Record<Permission, string> = {
  'organization:view': 'Departman / organizasyon yapısını görüntüler',
  'organization:manage': 'Departman / organizasyon yapısını düzenler',
  'employee:viewAll': 'Tüm çalışanların listesini görüntüler',
  'employee:manage': 'Çalışan kayıtlarını düzenler',
  'employee:create': 'Yeni çalışan kaydı oluşturur',
  'workflow:view': 'Onay taleplerinin durumunu görüntüler',
  'workflow:create': 'Kendi adına onay talebi oluşturur',
  'workflow:decide': 'Onay kutusundaki taleplere karar verir',
  'leave:view': 'İzin taleplerini ve bakiyelerini görüntüler',
  'leave:create': 'Kendi adına izin talebi oluşturur',
  'leave:manageBalance': 'Çalışanların yıllık izin bakiyesini tanımlar',
  'recruitment:view': 'Açık iş ilanlarını görüntüler',
  'recruitment:candidates': 'Adayları görüntüler, başvuru sürecini yönetir',
  'recruitment:publish': 'İş ilanı oluşturur ve yayına alır',
  'onboarding:view': 'Onboarding planlarını görüntüler',
  'onboarding:manage': 'Onboarding planı oluşturur, düzenler',
  'asset:manage': 'Zimmet / demirbaş kayıtlarını yönetir',
  'timeshift:view': 'Puantaj ve vardiya bilgilerini görüntüler',
  'timeshift:clock': 'Kendi mesai giriş / çıkışını kaydeder',
  'timeshift:manage': 'Vardiya deseni ve puantaj kayıtlarını yönetir',
  'performance:view': 'Performans değerlendirmelerini görüntüler',
  'performance:manage': 'Performans değerlendirme sürecini yönetir',
  'team:manage': 'Ekip kurar, lider atar, üye ekler / çıkarır',
  'learning:view': 'Eğitim kataloğunu görüntüler',
  'learning:enroll': 'Bir eğitime kayıt olur',
  'learning:manage': 'Eğitim kataloğuna eğitim ekler, düzenler',
  'compensation:view': 'Ücret bantlarını ve maaş geçmişini görüntüler',
  'expense:view': 'Masraf taleplerini görüntüler',
  'expense:create': 'Kendi adına masraf talebi oluşturur',
  'expense:manage': 'Masraf taleplerini onaylar / yönetir',
  'expense:markPaid': 'Onaylanan masraf talebini ödendi işaretler',
  'document:manage': 'Şirket dokümanlarını yönetir',
  'case:view': 'İK vakalarını görüntüler',
  'case:create': 'Yeni İK vakası açar',
  'case:manage': 'İK vakalarını yönetir, sonuçlandırır',
  'notification:view': 'Kendine gelen bildirimleri görüntüler',
  'notification:manage': 'Bildirim şablonlarını oluşturur / düzenler',
  'platform:manage': 'Platformdaki tüm kiracıları yönetir',
  'tenant:manage': 'Kendi şirketinin (kiracının) ayarlarını yönetir',
}

/**
 * "Ek izin" mekanizması backend'de RequireTenantAdmin ile korunuyor ve
 * herhangi bir Permission adını Keycloak'ta bir role çevirip atayabiliyor -
 * ama o rolü GERÇEKTEN tanıyıp yetkilendirmede kullanan servis yoksa,
 * atama sessizce hiçbir şey açmaz. Bu liste, ilgili servisin Program.cs'inde
 * policy'si "ext-<izin>" rolünü de kabul edecek şekilde genişletilmiş tüm
 * izinleri kapsıyor. employee rolünün izinleri (organization:view,
 * workflow:view/create, leave:view/create, onboarding:view, timeshift:view/
 * clock, performance:view, learning:view/enroll, expense:view/create,
 * case:view/create, notification:view) burada YOK - backend'de zaten
 * AUTH_ONLY (herkese açık), bu yüzden "ek izin" mekanizması onlar için
 * anlamsız.
 */
const PERMISSIONS_WITH_BACKEND_SUPPORT = new Set<Permission>([
  'compensation:view',
  'employee:create',
  'employee:manage',
  'recruitment:candidates',
  'recruitment:publish',
  'asset:manage',
  'onboarding:manage',
  'leave:manageBalance',
  'learning:manage',
  'notification:manage',
  'document:manage',
  'expense:manage',
  'expense:markPaid',
  'case:manage',
  'organization:manage',
  'team:manage',
  'performance:manage',
  'workflow:decide',
  'timeshift:manage',
  'tenant:manage',
  'platform:manage',
])

interface RoleRow {
  employeeId: string
  keycloakUserId: string | null
  firstName: string
  lastName: string
  email: string
  hasLoginAccess: boolean
  roles: string[]
  extraPermissions: string[]
  /** organization-service'te bir departmanın başı olarak atanmış mı -
   * öyleyse ama "manager" rolü yoksa, bu kişi kendisine atanmış onay
   * adımlarını hiç karara bağlayamaz (RequireManagerOrAbove'dan geçemez). */
  isDepartmentHead: boolean
}

export function RolesPage() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const { roles: myRoles } = useAuth()
  const canGrantExtraPermissions = myRoles.includes('tenant-admin') || myRoles.includes('platform-admin')
  const [addingPermFor, setAddingPermFor] = useState<string | null>(null)

  const companies = useCompanies()
  const companyId = companies.data?.[0]?.id
  const departments = useDepartmentList(companyId)
  const membersQuery = useQuery({
    queryKey: ['team-members'],
    queryFn: ({ signal }) => tenantApi.members(signal),
  })

  const headEmployeeIds = useMemo(
    () => new Set((departments.data ?? []).map((d) => d.headEmployeeId).filter(Boolean)),
    [departments.data],
  )

  const rows: RoleRow[] = useMemo(
    () =>
      (membersQuery.data ?? []).map((m) => ({
        ...m,
        isDepartmentHead: headEmployeeIds.has(m.employeeId),
      })),
    [membersQuery.data, headEmployeeIds],
  )

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['team-members'] })

  const inviteMutation = useMutation({
    mutationFn: (employeeId: string) => tenantApi.inviteMember(employeeId),
    onSuccess: () => {
      invalidate()
      toast.ok('Davet gönderildi.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Davet gönderilemedi.'),
  })

  const assignMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      tenantApi.assignRole(userId, role),
    onSuccess: () => {
      invalidate()
      toast.ok('Rol atandı.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Rol atanamadı.'),
  })

  const removeMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      tenantApi.removeRole(userId, role),
    onSuccess: () => {
      invalidate()
      toast.ok('Rol kaldırıldı.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Rol kaldırılamadı.'),
  })

  const assignPermMutation = useMutation({
    mutationFn: ({ userId, permission }: { userId: string; permission: string }) =>
      tenantApi.assignExtraPermission(userId, permission),
    onSuccess: () => {
      invalidate()
      setAddingPermFor(null)
      toast.ok('İzin atandı.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'İzin atanamadı.'),
  })

  const removePermMutation = useMutation({
    mutationFn: ({ userId, permission }: { userId: string; permission: string }) =>
      tenantApi.removeExtraPermission(userId, permission),
    onSuccess: () => {
      invalidate()
      toast.ok('İzin kaldırıldı.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'İzin kaldırılamadı.'),
  })

  const pending = assignMutation.isPending || removeMutation.isPending

  function toggleRole(row: RoleRow, role: Role, checked: boolean) {
    if (!row.keycloakUserId) return
    if (checked) assignMutation.mutate({ userId: row.keycloakUserId, role })
    else removeMutation.mutate({ userId: row.keycloakUserId, role })
  }

  const employeeColumn: Column<RoleRow> = {
    id: 'employee',
    header: 'Çalışan',
    searchText: (r) => `${r.firstName} ${r.lastName} ${r.email}`,
    sortValue: (r) => `${r.firstName} ${r.lastName}`,
    cell: (r) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-[13px] font-medium">
            {r.firstName} {r.lastName}
          </p>
          {r.isDepartmentHead && !r.roles.includes('manager') && !r.roles.includes('hr-admin') && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ShieldAlert className="size-3.5 shrink-0 text-[hsl(var(--warning))]" />
                </TooltipTrigger>
                <TooltipContent className="max-w-64 text-[12px] leading-relaxed">
                  Bir departmanın başı ama Yönetici rolü yok - kendisine atanan onayları
                  karara bağlayamaz.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="truncate text-[12px] text-muted-foreground">{r.email}</p>
      </div>
    ),
  }

  const roleColumns: Column<RoleRow>[] = ASSIGNABLE_ROLES.map((role) => ({
    id: `role-${role}`,
    header: roleLabels[role],
    align: 'left',
    sortValue: (r) => (r.roles.includes(role) ? 1 : 0),
    cell: (r) =>
      r.hasLoginAccess ? (
        <Checkbox
          checked={r.roles.includes(role)}
          disabled={pending || !r.keycloakUserId}
          onCheckedChange={(checked) => toggleRole(r, role, checked === true)}
          aria-label={`${r.firstName} ${r.lastName} için ${roleLabels[role]} rolü`}
        />
      ) : (
        <span className="text-[12px] text-muted-foreground">—</span>
      ),
  }))

  const inviteColumn: Column<RoleRow> = {
    id: 'invite',
    header: '',
    cell: (r) =>
      r.hasLoginAccess ? null : (
        <Button
          size="sm"
          variant="outline"
          className="cursor-pointer"
          disabled={inviteMutation.isPending}
          onClick={() => inviteMutation.mutate(r.employeeId)}
        >
          <Mail className="size-3.5" />
          Giriş erişimi ver
        </Button>
      ),
  }

  /**
   * Standart 5 rolün dışında, kullanıcının rolünden bağımsız tek tek izin
   * atama - yalnızca Şirket/Platform Yöneticisi görür ve kullanır
   * (backend RequireTenantAdmin ile zaten aynı kısıtı uyguluyor; burada
   * sütunu hiç göstermemek, yetkisi olmayan birinin boş bir "+" ile
   * karşılaşıp 403 almasını da önlüyor).
   */
  const extraPermColumn: Column<RoleRow> = {
    id: 'extra-permissions',
    header: 'Ek izinler',
    cell: (r) => {
      if (!r.hasLoginAccess) return <span className="text-[12px] text-muted-foreground">—</span>
      const available = Array.from(PERMISSIONS_WITH_BACKEND_SUPPORT).filter(
        (p) => !r.extraPermissions.includes(p),
      )
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.extraPermissions.map((perm) => (
            <StatusBadge key={perm} tone="warning" className="group gap-1">
              {PERMISSION_LABELS[perm as Permission] ?? perm}
              <button
                type="button"
                aria-label={`${PERMISSION_LABELS[perm as Permission] ?? perm} iznini kaldır`}
                className="cursor-pointer opacity-60 hover:opacity-100"
                disabled={removePermMutation.isPending}
                onClick={() =>
                  r.keycloakUserId &&
                  removePermMutation.mutate({ userId: r.keycloakUserId, permission: perm })
                }
              >
                <X className="size-3" />
              </button>
            </StatusBadge>
          ))}

          {addingPermFor === r.employeeId ? (
            available.length === 0 ? (
              <span className="text-[12px] text-muted-foreground">Eklenecek izin yok</span>
            ) : (
              <SelectField
                id={`add-perm-${r.employeeId}`}
                label=""
                value=""
                onChange={(permission) =>
                  r.keycloakUserId &&
                  assignPermMutation.mutate({ userId: r.keycloakUserId, permission })
                }
                options={available.map((p) => ({ value: p, label: PERMISSION_LABELS[p] }))}
                placeholder="İzin seç"
                className="w-56"
              />
            )
          ) : (
            <button
              type="button"
              className="cursor-pointer text-muted-foreground opacity-60 hover:opacity-100"
              aria-label="Ek izin ekle"
              onClick={() => setAddingPermFor(r.employeeId)}
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      )
    },
  }

  return (
    <div>
      <PageHeader
        title="Roller"
        description="Çalışanların sistem yetkilerini tek tablodan verin ya da kaldırın. Bir hücreyi işaretlemek o rolü ekler."
      />

      <TooltipProvider>
        <div className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
          {ASSIGNABLE_ROLES.map((role) => (
            <Tooltip key={role}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex cursor-help items-center gap-1 text-[12px] text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
                >
                  <Info className="size-3" />
                  {roleLabels[role]}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72 text-[12px] leading-relaxed">
                <p className="mb-1.5 font-medium">{ROLE_SUMMARY[role]}</p>
                <p className="text-muted-foreground">
                  {Array.from(permissionsFor([role])).sort().join(' · ')}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>

      <DataTable<RoleRow>
        rows={rows}
        rowKey={(r) => r.employeeId}
        isLoading={membersQuery.isPending}
        error={membersQuery.error}
        emptyTitle="Henüz çalışan yok"
        emptyDetail="Önce Çalışanlar bölümünden ekleyin."
        searchPlaceholder="Ad, soyad veya e-posta"
        columns={[
          employeeColumn,
          ...roleColumns,
          ...(canGrantExtraPermissions ? [extraPermColumn] : []),
          inviteColumn,
        ]}
      />

      {canGrantExtraPermissions && (
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          <Info className="mr-1 inline size-3" />
          Ek izinler, bir çalışana rolünün dışında tek bir yetki verir - yalnızca Şirket ve
          Platform Yöneticisi bu şekilde izin atayabilir.
        </p>
      )}

      <p className="mt-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        Bir tenant&apos;ta en az bir Şirket Yöneticisi kalmalı - son kişinin rolü kaldırılamaz.
      </p>
    </div>
  )
}
