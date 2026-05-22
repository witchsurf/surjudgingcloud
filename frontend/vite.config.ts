import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const resolveExpectedSchemaVersion = () => {
  if (process.env.SURFJUDGING_SCHEMA_VERSION) {
    return process.env.SURFJUDGING_SCHEMA_VERSION
  }

  try {
    const migrationsDir = resolve(__dirname, '../backend/supabase/migrations')
    const migrationFiles = readdirSync(migrationsDir)
      .filter((file) => /^\d.+\.sql$/.test(file))
      .sort()
    const latest = migrationFiles.at(-1)
    return latest ? latest.replace(/\.sql$/, '') : 'unknown'
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '0.0.0'),
    'import.meta.env.VITE_APP_BUILD': JSON.stringify(process.env.SURFJUDGING_BUILD_ID || new Date().toISOString()),
    'import.meta.env.VITE_EXPECTED_SCHEMA_VERSION': JSON.stringify(resolveExpectedSchemaVersion()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Use the existing manifest.json in /public
      manifest: false,
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Cache all built assets (JS, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            // Google Fonts stylesheets
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            // Google Fonts webfont files
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }, // 1 year
            },
          },
        ],
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          pdf: ['jspdf', 'jspdf-autotable']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache', 'e2e/**']
  }
})
