import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // /__/auth/** is proxied straight through to Firebase's real auth
      // handler (see vercel.json) -- never let the service worker intercept
      // or cache it, that's exactly the kind of thing that breaks Google
      // Sign-In in ways that are miserable to debug.
      workbox: {
        navigateFallbackDenylist: [/^\/__\/auth\//],
      },
      manifest: {
        name: 'DuePlanner',
        short_name: 'DuePlanner',
        description: 'A fast, highly personalizable homework and task planner -- due dates, subjects, recurring tasks, reminders, and focus tools, all in one place.',
        start_url: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/favicon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
})
