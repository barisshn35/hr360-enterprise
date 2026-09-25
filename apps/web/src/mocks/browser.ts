/**
 * MSW tarayıcı girişi.
 *
 * `VITE_MOCK_API=true` iken `main.tsx` bu modülü dinamik olarak yükler ve
 * uygulama çizilmeden önce service worker'ı başlatır. Anahtar kapalıyken
 * derleme bu dosyayı hiç içermez (bkz. `vite.config.ts` → `__MOCK_API__`).
 *
 * Handler sırası önemli: özel yollar (`/reviews/score`) genel yollardan
 * (`/reviews/:id`) önce, en sondaki `/api/*` yakalayıcıdan önce tanımlı.
 */

import { setupWorker } from 'msw/browser'
import { organizationHandlers } from './handlers/organization'
import { performanceHandlers } from './handlers/performance'
import { shellHandlers } from './handlers/shell'
import { getStore as getShiftStore, timeshiftHandlers } from './handlers/timeshift'
import { getDb } from './db'

export async function startMocks() {
  // Tohum ilk istekten önce kurulsun; URL'deki ?senaryo / ?sifirla burada okunur.
  getDb()
  getShiftStore()
  const worker = setupWorker(
    ...performanceHandlers,
    ...organizationHandlers,
    ...timeshiftHandlers,
    ...shellHandlers,
  )
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    // /auth, /ml ve statik dosyalar olduğu gibi geçer.
    onUnhandledRequest: 'bypass',
    quiet: true,
  })
  console.info('[HR360] Mock API etkin — veriler src/mocks/ altından geliyor.')
}
