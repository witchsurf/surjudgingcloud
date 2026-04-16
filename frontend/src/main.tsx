import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
// Ensure heat helpers (including global getHeatIdentifiers fallback) are loaded before app bootstrap.
import './utils/heat';
import { initStorageCleanup } from './utils/secureStorage';
import { processMagicLinkCallback } from './utils/magicLink';

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isPublicDisplayHost = hostname === 'display.surfjudging.cloud';
const isLocalLanHost =
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname.startsWith('192.168.') ||
  hostname.startsWith('10.') ||
  hostname.startsWith('172.');

if (!isLocalLanHost && !isPublicDisplayHost) {
  const updateSW = registerSW({
    onNeedRefresh() {
      console.log('🔄 New version available – app will auto-update on next visit');
    },
    onOfflineReady() {
      console.log('✅ App ready to work offline');
    },
  });
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
  void updateSW;
} else {
  console.log('📴 Service worker disabled on local/LAN or public display host');
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister().catch(() => {});
      });
    }).catch(() => {});
  }
}

// Bootstrap: await magic-link session before mounting the app to avoid race conditions
async function bootstrap() {
  // CRITICAL: Wait for magic-link callback to establish the session BEFORE rendering.
  // Without this, the app renders with user=null, effects fire, and navigation redirects
  // the user away from /my-events before the session is ready.
  if (!isLocalLanHost) {
    try {
      await processMagicLinkCallback();
    } catch (err) {
      console.error('Magic link callback error during bootstrap:', err);
    }
  } else {
    console.log('📴 Magic-link bootstrap skipped on local/LAN host');
  }

  // Initialize secure storage cleanup on app load
  initStorageCleanup();

  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const resetFlagKey = 'surfapp_dev_bootstrap';
    try {
      if (!sessionStorage.getItem(resetFlagKey)) {
        // Migration bridge: purge legacy localStorage keys that were replaced
        // by Zustand persist (key: 'surf-judging-config').
        // Can be removed once all legacy paths (router.tsx wrappers, App.legacy.tsx) are retired.
        const keysToClear = [
          'eventData',
          'eventId',
          'participants',
          'heats',
          'surfJudgingConfig',        // Replaced by Zustand persist 'surf-judging-config'
          'surfJudgingConfigSaved',   // Managed by configStore.configSaved
          'surfJudgingScores',
          'surfJudgingTimer',
          'surfJudgingJudgeWorkCount',
          'surfJudgingOverrideLogs',
          'surfapp_offline_queue'
        ];
        keysToClear.forEach((key) => localStorage.removeItem(key));
        sessionStorage.setItem(resetFlagKey, 'true');
      }
    } catch (error) {
      console.warn('Could not reset local state for dev session:', error);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap();
