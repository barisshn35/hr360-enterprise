import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles/index.css'
// Hareket katmanı ayrı dosyada: index.css devir paketinden geldiği gibi kalıyor.
import './styles/motion.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root öğesi bulunamadı.')

/**
 * Mock anahtarları (`VITE_MOCK_API`, `VITE_MOCK_AUTH`) derleme anında sabite
 * dönüşür. Kapalıyken bu dallar ve `src/mocks/` paketten tamamen düşer.
 */
async function prepare() {
  if (__MOCK_API__) {
    const { startMocks } = await import('./mocks/browser')
    await startMocks()
  }
  if (__MOCK_API__ || __MOCK_AUTH__) {
    const { mountMockBar } = await import('./mocks/MockBar')
    mountMockBar()
  }
}

/**
 * PWA: üretim derlemesinde servis çalışanını kaydet (mock modunda MSW kendi
 * çalışanını kullandığı için atlanır). Uygulama kabuğu çevrimdışı da açılır.
 */
if (import.meta.env.PROD && !__MOCK_API__ && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => console.warn('[HR360] Servis çalışanı kaydedilemedi:', e))
  })
}

void prepare()
  .catch((e: unknown) => console.error('[HR360] Mock katmanı başlatılamadı:', e))
  .finally(() => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
