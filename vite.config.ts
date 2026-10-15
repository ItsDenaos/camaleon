import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { SECURITY_HEADERS, netlifyHeadersFile } from './vite/headers';
import { mediapipeWasm } from './vite/mediapipe';

export default defineConfig(({ mode }) => ({
  plugins: [
    preact(),
    mediapipeWasm(),
    netlifyHeadersFile(),
    VitePWA({
      // We show our own "update available" notice: never reload mid-recording.
      registerType: 'prompt',
      injectRegister: false,
      // Icons and favicon are already matched by globPatterns below.
      includeManifestIcons: false,
      manifest: {
        name: 'Camaleón — efectos para tu webcam',
        short_name: 'Camaleón',
        description:
          'Efectos en tiempo real para tu webcam: filtros, fondos, caras, fotos, GIF y vídeo. Todo se procesa en tu dispositivo.',
        lang: 'es',
        dir: 'ltr',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b0b10',
        theme_color: '#0b0b10',
        categories: ['photo', 'entertainment', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell is precached on the first visit…
        globPatterns: ['**/*.{js,css,html,svg,png}'], // the manifest is added by the plugin
        // …but the ~17 MB of AI runtime + models only when first used (below).
        globIgnores: ['**/mediapipe/**', '**/models/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/(mediapipe|models)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'camaleon-ia',
              expiration: { maxEntries: 12 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
    // `npm run dev:movil` serves over HTTPS on the LAN: phones only allow the camera on secure origins.
    mode === 'lan' && basicSsl(),
  ],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
  // `npm run preview` serves dist/ with the same headers as production (CSP included).
  preview: {
    headers: SECURITY_HEADERS,
  },
  // Both are imported lazily (GIF worker, AI on first use); pre-bundle them so the first
  // use in dev doesn't trigger a dependency re-optimization (and a page reload).
  optimizeDeps: {
    include: ['gifenc', '@mediapipe/tasks-vision'],
  },
}));
