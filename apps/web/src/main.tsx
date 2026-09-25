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

void prepare()
  .catch((e: unknown) => console.error('[HR360] Mock katmanı başlatılamadı:', e))
  .finally(() => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
