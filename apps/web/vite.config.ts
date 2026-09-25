import { rmSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev sırasında backend'e (Cloudflare üzerinden public olan gateway) proxy'lenir.
// VPN gerekmez: https://hr360.local hem /auth hem /api/* hem /ml/* servis ediyor.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_PROXY_TARGET || 'https://hr360.local'
  const proxy = { target, changeOrigin: true, secure: true }

  // Mock anahtarları derleme anında sabite dönüşür. Kapalıyken (varsayılan)
  // `if (__MOCK_API__)` dalları ve içindeki dinamik import'lar paketten tamamen düşer.
  const mockApi = env.VITE_MOCK_API === 'true'
  const mockAuth = env.VITE_MOCK_AUTH === 'true'

  // Mock kapalı derlemede MSW service worker dosyası pakette durmasın.
  const dropMockWorker: Plugin = {
    name: 'hr360-drop-mock-worker',
    apply: 'build',
    closeBundle() {
      if (!mockApi) rmSync(fileURLToPath(new URL('./dist/mockServiceWorker.js', import.meta.url)), { force: true })
    },
  }

  return {
    plugins: [react(), tailwindcss(), dropMockWorker],
    define: {
      __MOCK_API__: JSON.stringify(mockApi),
      __MOCK_AUTH__: JSON.stringify(mockAuth),
    },
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
      // Tek React örneği: aksi halde motion kendi kopyasını çözer.
      dedupe: ['react', 'react-dom'],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { ...proxy },
        '/ml': { ...proxy },
        '/auth': { ...proxy },
        '/gateway': { ...proxy },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            auth: ['keycloak-js'],
            motion: ['motion'],
            query: ['@tanstack/react-query'],
          },
        },
      },
    },
  }
})
