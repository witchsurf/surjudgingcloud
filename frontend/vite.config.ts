import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const deploymentMode = process.env.VITE_DEPLOYMENT_MODE || (process.env.VITEST ? 'field' : '')
const releaseId = process.env.SURFJUDGING_RELEASE_ID || process.env.SURFJUDGING_BUILD_ID || 'unreleased'
const codeRevision = process.env.SURFJUDGING_CODE_REVISION || (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: resolve(__dirname, '..'), encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
})()

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
    'import.meta.env.VITE_APP_BUILD': JSON.stringify(releaseId),
    'import.meta.env.VITE_EXPECTED_SCHEMA_VERSION': JSON.stringify(resolveExpectedSchemaVersion()),
    'import.meta.env.VITE_DEPLOYMENT_MODE': JSON.stringify(deploymentMode),
    ...(deploymentMode === 'field' ? {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY_LOCAL': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY_LOCAL || process.env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY_LAN': JSON.stringify(process.env.VITE_SUPABASE_ANON_KEY_LAN || process.env.VITE_SUPABASE_ANON_KEY || ''),
      'import.meta.env.VITE_SUPABASE_URL_CLOUD': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY_CLOUD': '""'
    } : {}),
  },
  plugins: [
    react(),
    {
      name: 'surfjudging-deployment-manifest',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'deployment-manifest.json',
          source: JSON.stringify({
            deploymentMode,
            releaseId,
            codeRevision,
            expectedSchemaVersion: resolveExpectedSchemaVersion(),
            cloudTestActivationSupported: deploymentMode === 'cloud',
            publicApiUrl: process.env.VITE_SUPABASE_URL_LAN || process.env.VITE_SUPABASE_URL_LOCAL || null,
            publicFrontendPort: process.env.VITE_FRONTEND_PORT || null,
          }, null, 2),
        })
      },
    },
    VitePWA({
      // Field is an autonomous LAN runtime and must never install a browser
      // service worker. Its assets are already served by the local runtime;
      // generating a dormant worker would only create an accidental future
      // registration path and make Cloud/Field artifacts harder to audit.
      disable: deploymentMode === 'field',
      // Never force-reload Admin/Judge/Display while a heat is running. The
      // application explicitly activates a waiting release only on a passive
      // route; otherwise it activates naturally after all tabs are closed.
      registerType: 'prompt',
      // Use the existing manifest.json in /public
      manifest: false,
      workbox: {
        skipWaiting: false,
        clientsClaim: false,
        cleanupOutdatedCaches: true,
        // Cache all built assets (JS, CSS, HTML)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: deploymentMode === 'cloud' ? [
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
        ] : [],
      },
    }),
  ],
  build: {
    outDir: process.env.P1_DIST_DIR || undefined,
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
