/**
 * Mock modu şeridi — mock açıkken sol altta durur.
 *
 * İki işi var: (1) mock verisiyle çalıştığınızı asla unutturmamak,
 * (2) rolü ve senaryoyu tek tıkla değiştirmek (URL'ye `?rol=` / `?senaryo=`
 * yazıp sayfayı yeniler). Uygulamanın dışında, ayrı bir kökte çizilir.
 */

import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FlaskConical, RotateCcw, X } from 'lucide-react'
import { readScenario, scenarioLabels, type Scenario } from './scenario'
import { MOCK_ROLES, mockRoleLabels, readMockRole, type MockRole } from './session'

function go(params: Record<string, string>) {
  const url = new URL(window.location.href)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  window.location.assign(url.toString())
}

function MockBar() {
  const [open, setOpen] = useState(false)
  const role = readMockRole()
  const scenario = readScenario()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-warning/40 bg-card/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-lg backdrop-blur transition hover:border-warning"
        aria-label="Mock modu ayarlarını aç"
      >
        <FlaskConical className="h-3.5 w-3.5 text-warning" aria-hidden />
        Mock · {mockRoleLabels[role]}
        {scenario !== 'normal' && <span className="text-muted-foreground">· {scenarioLabels[scenario]}</span>}
      </button>
    )
  }

  return (
    <div className="w-72 rounded-xl border border-warning/40 bg-card/95 p-3 text-xs text-foreground shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold">
          <FlaskConical className="h-3.5 w-3.5 text-warning" aria-hidden />
          Mock modu
        </span>
        <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Kapat">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-3 text-muted-foreground">Veriler tarayıcıda üretiliyor; backend'e istek gitmiyor.</p>

      <div className="mb-1 font-medium">Rol</div>
      <div className="mb-3 grid grid-cols-3 gap-1">
        {MOCK_ROLES.map((r: MockRole) => (
          <button
            key={r}
            type="button"
            onClick={() => go({ rol: r })}
            className={`rounded-md border px-2 py-1.5 transition ${r === role ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
          >
            {mockRoleLabels[r]}
          </button>
        ))}
      </div>

      <div className="mb-1 font-medium">Senaryo</div>
      <div className="mb-3 grid grid-cols-2 gap-1">
        {(Object.keys(scenarioLabels) as Scenario[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => go({ senaryo: s })}
            className={`rounded-md border px-2 py-1.5 transition ${s === scenario ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'}`}
          >
            {scenarioLabels[s]}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => go({ sifirla: '1' })}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 hover:bg-muted"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Örnek veriyi sıfırla
      </button>
    </div>
  )
}

export function mountMockBar() {
  const host = document.createElement('div')
  host.id = 'hr360-mock-bar'
  host.style.position = 'fixed'
  host.style.left = '12px'
  host.style.bottom = '12px'
  host.style.zIndex = '2147483000'
  document.body.appendChild(host)
  createRoot(host).render(<MockBar />)

  // ?sifirla=1 bir kez uygulanır; adres çubuğunda kalıp her yenilemede sıfırlamasın.
  const url = new URL(window.location.href)
  if (url.searchParams.has('sifirla')) {
    url.searchParams.delete('sifirla')
    window.history.replaceState(null, '', url.toString())
  }
}
