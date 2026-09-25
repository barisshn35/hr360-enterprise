import { ArrowRight, ExternalLink, Key, Monitor, Moon, Sun, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DataField, Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ProgressBar } from '@/components/ui/Progress'
import { useAuth } from '@/auth/useAuth'
import { permissionsFor, primaryRole, roleLabels, type Role } from '@/auth/roles'
import { tenantPlanLabels, tenantStatusLabels } from '@/api/tenant'
import { useTheme, type Theme } from '@/lib/theme'
import { formatDate, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { CompanyNamePanel, BrandingPanel } from './BrandingPanel'

const THEMES: Array<{ value: Theme; label: string; icon: React.ElementType }> = [
  { value: 'light', label: 'Açık', icon: Sun },
  { value: 'dark', label: 'Koyu', icon: Moon },
  { value: 'system', label: 'Sistem', icon: Monitor },
]

export function SettingsPage() {
  const { user, roles, tenant, tenantSlug, tenantError, accountUrl, logout, can } = useAuth()
  const { theme, setTheme } = useTheme()

  const permissions = [...permissionsFor(roles)].sort()
  const quotaUsed = 0 // Kiracı ucu çalışan sayısını döndürmüyorsa 0 kalır.

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ayarlar"
        description="Hesabınız, şirketiniz ve arayüz tercihleri."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Hesap" note="Kimlik bilgileri Keycloak'tan gelir" />
          <PanelBody className="space-y-4">
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <DataField label="Ad soyad">{user?.fullName ?? '—'}</DataField>
              <DataField label="Kullanıcı adı">
                <span className="font-mono text-[12px]">{user?.username ?? '—'}</span>
              </DataField>
              <DataField label="E-posta">{user?.email ?? 'Tanımlı değil'}</DataField>
              <DataField label="Rol">
                <StatusBadge tone="info">{roleLabels[primaryRole(roles)]}</StatusBadge>
              </DataField>
            </dl>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              {accountUrl !== '#' && (
                <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                  <a href={accountUrl} target="_blank" rel="noreferrer">
                    Keycloak hesabım
                    <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => logout()}
              >
                Oturumu kapat
              </Button>
            </div>

            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Parola değişikliği ve iki adımlı doğrulama Keycloak hesap sayfasından yapılır; bu
              uygulama parolanızı hiçbir zaman görmez.
            </p>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHead title="Şirket" note="Bağlı olduğunuz kiracı" />
          <PanelBody className="space-y-4">
            {!tenantSlug ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-[hsl(var(--warning))]/40 bg-[hsl(var(--warning))]/10 p-3.5"
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-[hsl(var(--warning))]"
                />
                <p className="text-[13px] leading-relaxed">
                  Oturumunuzda <code className="font-mono text-[12px]">organization</code> claim'i
                  yok. Bu yüzden listeler boş görünür. Oturumu kapatıp yeniden girin.
                </p>
              </div>
            ) : tenantError ? (
              <p className="text-[13px] leading-relaxed text-muted-foreground">{tenantError}</p>
            ) : !tenant ? (
              <p className="text-[13px] text-muted-foreground">Kiracı bilgisi yükleniyor…</p>
            ) : (
              <>
                <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  <DataField label="Şirket">{tenant.name}</DataField>
                  <DataField label="Kısa ad">
                    <span className="font-mono text-[12px]">{tenant.slug}</span>
                  </DataField>
                  <DataField label="Plan">
                    <StatusBadge tone="info">{tenantPlanLabels[tenant.plan]}</StatusBadge>
                  </DataField>
                  <DataField label="Durum">
                    <StatusBadge tone={tenant.status === 'Active' ? 'success' : 'warning'}>
                      {tenantStatusLabels[tenant.status]}
                    </StatusBadge>
                  </DataField>
                  <DataField label="Kayıt tarihi">{formatDate(tenant.createdAt)}</DataField>
                  <DataField label="E-posta alan adı">{tenant.emailDomain ?? '—'}</DataField>
                </dl>

                <div className="border-t border-border pt-4">
                  <div className="mb-2 flex items-baseline justify-between gap-4">
                    <span className="text-[12px] text-muted-foreground">Çalışan kotası</span>
                    <span className="tabular text-[12px] text-muted-foreground">
                      {formatNumber(tenant.employeeCount ?? quotaUsed)} /{' '}
                      {formatNumber(tenant.maxEmployees)}
                    </span>
                  </div>
                  <ProgressBar
                    value={tenant.employeeCount ?? quotaUsed}
                    max={tenant.maxEmployees || 1}
                    tone="info"
                    label="Çalışan kotası"
                  />
                </div>
              </>
            )}
          </PanelBody>
        </Panel>
      </div>

      {can('employee:manage') && (
        <Panel>
          <PanelHead
            title="Ekip ve roller"
            note="Çalışanlara giriş erişimi verin, rollerini yönetin"
          />
          <PanelBody>
            <Link
              to="/panel/roller"
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/40"
            >
              <span className="flex items-center gap-2.5">
                <Key className="size-4 text-muted-foreground" />
                <span className="text-[13px]">
                  Tüm çalışanların rollerini tek tablodan yönetin
                </span>
              </span>
              <ArrowRight className="size-4 text-muted-foreground" />
            </Link>
          </PanelBody>
        </Panel>
      )}

      {tenant && can('tenant:manage') && (
        <>
          <CompanyNamePanel tenant={tenant} />
          {tenant.plan === 'Enterprise' && <BrandingPanel tenant={tenant} />}
        </>
      )}

      <Panel>
        <PanelHead title="Görünüm" note="Tercih bu tarayıcıda saklanır" />
        <PanelBody>
          <div role="radiogroup" aria-label="Tema" className="flex flex-wrap gap-2">
            {THEMES.map((option) => {
              const Icon = option.icon
              const active = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-4 text-[13px] font-medium transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                  {option.label}
                </button>
              )
            })}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead
          title="İzinleriniz"
          note="Arayüzde neyi görebildiğinizi bu liste belirler"
          action={
            <span className="tabular text-[12px] text-muted-foreground">
              {formatNumber(permissions.length)} izin
            </span>
          }
        />
        <PanelBody className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {roles.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Oturumunuza hiç rol atanmamış. Sistem yöneticinizle görüşün.
              </p>
            ) : (
              roles
                .filter((r): r is Role => r in roleLabels)
                .map((r) => (
                  <StatusBadge key={r} tone="neutral">
                    {roleLabels[r]}
                  </StatusBadge>
                ))
            )}
          </div>

          <ul className="flex flex-wrap gap-1.5 border-t border-border pt-4">
            {permissions.map((p) => (
              <li
                key={p}
                className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {p}
              </li>
            ))}
          </ul>

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Bu liste yalnızca arayüzün neyi gösterdiğini açıklar. Gerçek yetkilendirme her istekte
            sunucu tarafında yeniden denetlenir; buradaki bir izin backend'de karşılığı yoksa işlem
            yine reddedilir.
          </p>
        </PanelBody>
      </Panel>
    </div>
  )
}
