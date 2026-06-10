import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-512-maskable.png'],
      manifest: {
        name: "The Factor's Charter",
        short_name: 'Charter',
        description: 'A 1720s mercantile RPG.',
        theme_color: '#5c1a08',
        background_color: '#f0e3c4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        id: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // /plates/*.jpg are 6 × ~100 KB period engravings only encountered
        // after a player action that masks load latency (opening a letter,
        // completing a voyage). Excluding them from precache keeps the SW
        // install slim; the runtimeCaching rule below makes second
        // encounter instant.
        globIgnores: ['plates/**'],
        // Without these two flags, a new SW landing in the user's browser
        // sits in 'waiting' state until every old tab unloads — meaning
        // a deploy can take a full close-and-reopen of the PWA before
        // the new bundle is served. Bradley hit this multiple times during
        // the 2026-05-09/10 playtests (saw old fallback prose after each
        // ship). skipWaiting promotes the new SW immediately on install;
        // clientsClaim lets it take control of already-open pages on the
        // next reload instead of waiting for full unload. Net effect:
        // future deploys land on one refresh, not three.
        skipWaiting: true,
        clientsClaim: true,
        // Fonts are self-hosted woff2 at public/fonts/ (since 2026-06-09) and
        // covered by the woff2 glob above — no Google Fonts runtime rule needed.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/plates/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'plates',
              expiration: { maxEntries: 6, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
