import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { BookOpenText, Globe2, LoaderCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Panel, PanelBody, PanelHead } from '@/components/ui/Panel'
import { ErrorState, InfoNote } from '@/components/ui/States'
import { getValidToken } from '@/auth/keycloak'
import { env } from '@/lib/env'
import { cn } from '@/lib/utils'
import { toGatewaySpec, type Spec } from '@/lib/openapi'

/**
 * Birleşik API belgesi: her servisin OpenAPI tanımı gateway'den
 * (/api-docs/specs/<servis>.json, yalnızca oturum açmış kullanıcıya) alınır ve
 * gateway'deki gerçek adreslere çevrilir: servis içindeki "/api/leave-requests"
 * dışarıdan "/api/leave/leave-requests"tir. "Dene" düğmesi oturumdaki jetonla
 * istek atar; yani kullanıcı yalnızca zaten yetkili olduğu işlemleri yapabilir.
 */

type Doc = { id: string; title: string; detail: string; public?: boolean }

const DOCS: Doc[] = [
  { id: 'public', title: 'Açık API (v1)', detail: 'Dış sistemler için, X-Api-Key ile', public: true },
  { id: 'employee', title: 'Çalışanlar', detail: 'Çalışan kaydı, atamalar' },
  { id: 'organization', title: 'Organizasyon', detail: 'Şirket, departman, ekip' },
  { id: 'leave', title: 'İzin', detail: 'Bakiye, talep, resmi tatil' },
  { id: 'workflow', title: 'Onay akışları', detail: 'Adımlar, vekâlet, SLA' },
  { id: 'expense', title: 'Masraf ve İK vakaları', detail: 'Beyan, belge, vaka' },
  { id: 'timeshift', title: 'Vardiya ve puantaj', detail: 'Vardiya, giriş/çıkış' },
  { id: 'performance', title: 'Performans', detail: 'Dönem, hedef, değerlendirme' },
  { id: 'learning', title: 'Eğitim', detail: 'Katalog, kayıt, sertifika' },
  { id: 'compensation', title: 'Ücret', detail: 'Ücret geçmişi, bant' },
  { id: 'recruitment', title: 'İşe alım', detail: 'İlan, aday, mülakat' },
  { id: 'onboarding', title: 'İşe başlangıç', detail: 'Plan, görev, zimmet' },
  { id: 'notification', title: 'Bildirim', detail: 'Gelen kutusu, şablon' },
  { id: 'engagement', title: 'Bağlılık', detail: 'Takdir, anket, 1:1, ofis' },
  { id: 'governance', title: 'Yönetişim', detail: 'Denetim, kural, entegrasyon, AI' },
  { id: 'tenant', title: 'Kiracı', detail: 'Şirket hesabı, ekip, marka' },
]

async function loadSpec(doc: Doc): Promise<Spec> {
  if (doc.public) {
    const res = await fetch(`${env.apiBase}/api/governance/public/v1/openapi.json`)
    if (!res.ok) throw new Error(`Açık API tanımı alınamadı (HTTP ${res.status}).`)
    return (await res.json()) as Spec
  }
  const token = await getValidToken()
  const res = await fetch(`${env.apiBase}/api-docs/specs/${doc.id}.json`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`API tanımı alınamadı (HTTP ${res.status}).`)
  return toGatewaySpec(doc.id, (await res.json()) as Spec)
}

export function ApiDocsPage() {
  const [active, setActive] = useState<Doc>(DOCS[0])
  const spec = useQuery({ queryKey: ['api-docs', active.id], queryFn: () => loadSpec(active), staleTime: 5 * 60_000 })
  const count = useMemo(() => Object.keys(spec.data?.paths ?? {}).length, [spec.data])

  return (
    <>
      <PageHeader
        title="API belgeleri"
        description="Tüm servislerin uçları tek yerde. Panelden yaptığınız her işlem bu uçlarla yapılır."
      />
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <Panel className="h-fit">
          <PanelHead title="Servisler" />
          <PanelBody className="grid gap-1 p-2">
            {DOCS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setActive(d)}
                aria-current={active.id === d.id ? 'true' : undefined}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                  active.id === d.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-card hover:text-foreground',
                )}
              >
                {d.public ? <Globe2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <BookOpenText className="mt-0.5 size-4 shrink-0" />}
                <span>
                  <span className="block text-[13.5px] font-medium">{d.title}</span>
                  <span className="block text-[12px] text-muted-foreground">{d.detail}</span>
                </span>
              </button>
            ))}
          </PanelBody>
        </Panel>

        <div className="grid min-w-0 gap-4">
          <InfoNote>
            {active.public
              ? 'Açık API, Entegrasyonlar ekranında oluşturulan X-Api-Key ile çağrılır. "Authorize" düğmesine anahtarı girerek deneyebilirsiniz; dakikada 120 istek sınırı vardır.'
              : `"Try it out" istekleri oturumunuzun yetkisiyle gider: rolünüzün izin vermediği uçlar 403 döner. Adresler gateway'e göredir (${env.apiBase || 'bu sunucu'}/api/${active.id}/…).`}
          </InfoNote>
          <Panel className="min-w-0 overflow-hidden">
            <PanelHead title={active.title} note={spec.data ? `${count} uç` : undefined} />
            <PanelBody className="min-w-0 p-0">
              {spec.isPending && (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <LoaderCircle className="size-4 animate-spin" /> Tanım yükleniyor
                </div>
              )}
              {spec.isError && <ErrorState title="API tanımı alınamadı" message={(spec.error as Error).message} onRetry={() => void spec.refetch()} />}
              {spec.data && (
                // Swagger UI kendi açık temasını kullanır; okunaklı kalması için beyaz zemin.
                <div className="hr360-swagger rounded-b-2xl bg-white text-black">
                  <SwaggerUI
                    key={active.id}
                    spec={spec.data}
                    docExpansion="list"
                    defaultModelsExpandDepth={0}
                    tryItOutEnabled={false}
                    requestInterceptor={async (req) => {
                      if (!active.public) {
                        const token = await getValidToken()
                        if (token) req.headers = { ...req.headers, Authorization: `Bearer ${token}` }
                      }
                      return req
                    }}
                  />
                </div>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </>
  )
}
