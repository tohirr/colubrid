import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Service worker: precaches the built app (JS/CSS/HTML + the public/
    // assets below) so an installed colubrid launches instantly and works
    // fully offline after the first visit. autoUpdate = a new deploy
    // replaces the cached version on the next launch, no prompt.
    VitePWA({
      registerType: 'autoUpdate',
      // We hand-maintain public/manifest.webmanifest (linked in
      // index.html) — don't let the plugin generate a second one.
      manifest: false,
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
        'manifest.webmanifest',
        'og.png',
      ],
      workbox: {
        // The leaderboard is live data — never serve it from cache, and
        // never let a navigation to /api fall back to index.html.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
})
