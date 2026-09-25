import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Palette, Upload } from 'lucide-react'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { tenantApi, type Tenant } from '@/api/tenant'
import { qkt } from '@/api/queries-tenant'

/** Şirket adı düzenleme - tüm planlarda açık. */
export function CompanyNamePanel({ tenant }: { tenant: Tenant }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState(tenant.name)

  useEffect(() => setName(tenant.name), [tenant.name])

  const mutation = useMutation({
    mutationFn: (n: string) => tenantApi.renameCompany(n),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qkt.myTenant })
      toast.ok('Şirket adı güncellendi.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Güncellenemedi.'),
  })

  return (
    <Panel>
      <PanelHead title="Şirket adı" />
      <PanelBody className="space-y-3">
        <TextField
          id="company-name"
          label=""
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
        <Button
          size="sm"
          className="cursor-pointer"
          disabled={mutation.isPending || !name.trim() || name === tenant.name}
          onClick={() => mutation.mutate(name.trim())}
        >
          Kaydet
        </Button>
      </PanelBody>
    </Panel>
  )
}

/** Ana renk + kendi SMTP sunucusu - sadece Enterprise plan. */
export function BrandingPanel({ tenant }: { tenant: Tenant }) {
  const toast = useToast()
  const queryClient = useQueryClient()

  const [color, setColor] = useState(tenant.primaryColorHex ?? '#0b8f63')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('587')
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [smtpFromAddress, setSmtpFromAddress] = useState('')
  const [smtpFromName, setSmtpFromName] = useState('')

  useEffect(() => setColor(tenant.primaryColorHex ?? '#0b8f63'), [tenant.primaryColorHex])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qkt.myTenant })

  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadLogoMutation = useMutation({
    mutationFn: (file: File) => tenantApi.uploadLogo(file),
    onSuccess: () => {
      invalidate()
      toast.ok('Logo yüklendi.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Yüklenemedi.'),
  })

  const deleteLogoMutation = useMutation({
    mutationFn: () => tenantApi.deleteLogo(),
    onSuccess: () => {
      invalidate()
      toast.ok('Logo kaldırıldı.')
    },
  })

  const colorMutation = useMutation({
    mutationFn: (primaryColorHex: string) => tenantApi.updateBranding({ primaryColorHex }),
    onSuccess: () => {
      invalidate()
      toast.ok('Ana renk güncellendi.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Güncellenemedi.'),
  })

  const resetColorMutation = useMutation({
    mutationFn: () => tenantApi.updateBranding({ primaryColorHex: '' }),
    onSuccess: () => {
      invalidate()
      toast.ok('Varsayılan renge dönüldü.')
    },
  })

  const smtpMutation = useMutation({
    mutationFn: () =>
      tenantApi.updateBranding({
        smtpHost, smtpPort: Number(smtpPort) || 587, smtpUser,
        smtpPassword: smtpPassword || undefined,
        smtpFromAddress, smtpFromName,
      }),
    onSuccess: () => {
      invalidate()
      setSmtpPassword('')
      toast.ok('SMTP ayarları kaydedildi.')
    },
    onError: (e: unknown) => toast.stop(e instanceof Error ? e.message : 'Kaydedilemedi.'),
  })

  const removeSmtpMutation = useMutation({
    mutationFn: () => tenantApi.updateBranding({ smtpHost: '' }),
    onSuccess: () => {
      invalidate()
      toast.ok('Özel SMTP kaldırıldı, varsayılan gönderim kullanılacak.')
    },
  })

  return (
    <>
      <Panel>
        <PanelHead
          title="Logo"
          note="PNG, JPEG veya WebP - en fazla 2 MB"
        />
        <PanelBody className="space-y-3">
          <div className="flex items-center gap-4">
            {tenant.logoUrl ? (
              <img
                src={tenant.logoUrl}
                alt="Şirket logosu"
                className="h-16 w-16 rounded border border-border object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
                Logo yok
              </div>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={uploadLogoMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                {tenant.logoUrl ? 'Değiştir' : 'Yükle'}
              </Button>
              {tenant.logoUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  disabled={deleteLogoMutation.isPending}
                  onClick={() => deleteLogoMutation.mutate()}
                >
                  Kaldır
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadLogoMutation.mutate(file)
                  e.target.value = ''
                }}
              />
            </div>
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead
          title="Ana renk"
          note="Arayüzdeki marka rengini şirketinize göre değiştirin"
        />
        <PanelBody className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-16 cursor-pointer rounded border border-border bg-transparent"
              aria-label="Ana renk seçici"
            />
            <span className="font-mono text-[13px] text-muted-foreground">{color}</span>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="cursor-pointer"
              disabled={colorMutation.isPending || color === (tenant.primaryColorHex ?? '#0b8f63')}
              onClick={() => colorMutation.mutate(color)}
            >
              <Palette className="size-3.5" />
              Kaydet
            </Button>
            {tenant.primaryColorHex && (
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={resetColorMutation.isPending}
                onClick={() => resetColorMutation.mutate()}
              >
                Varsayılana dön
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHead
          title="Kendi SMTP sunucusu"
          note={
            tenant.hasCustomSmtp
              ? `Şu an ${tenant.smtpFromAddress ?? 'özel sunucu'} üzerinden gönderiliyor`
              : 'Ayarlanmazsa platformun varsayılan gönderim sunucusu kullanılır'
          }
        />
        <PanelBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              id="smtp-host" label="Sunucu" placeholder="smtp.sirketiniz.com"
              value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)}
            />
            <TextField
              id="smtp-port" label="Port" type="number" placeholder="587"
              value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)}
            />
            <TextField
              id="smtp-user" label="Kullanıcı adı"
              value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)}
            />
            <TextField
              id="smtp-password" label="Şifre" type="password"
              placeholder={tenant.hasCustomSmtp ? '(değiştirmek için girin)' : ''}
              value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)}
            />
            <TextField
              id="smtp-from-address" label="Gönderen e-posta" placeholder="noreply@sirketiniz.com"
              value={smtpFromAddress} onChange={(e) => setSmtpFromAddress(e.target.value)}
            />
            <TextField
              id="smtp-from-name" label="Gönderen adı" placeholder="Şirketiniz"
              value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="cursor-pointer"
              disabled={smtpMutation.isPending || !smtpHost.trim()}
              onClick={() => smtpMutation.mutate()}
            >
              Kaydet
            </Button>
            {tenant.hasCustomSmtp && (
              <Button
                size="sm"
                variant="outline"
                className="cursor-pointer"
                disabled={removeSmtpMutation.isPending}
                onClick={() => removeSmtpMutation.mutate()}
              >
                Kaldır
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
    </>
  )
}
