import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
// Ensure heat helpers (including global getHeatIdentifiers fallback) are loaded before app bootstrap.
import './utils/heat';
import { initStorageCleanup } from './utils/secureStorage';
import { processMagicLinkCallback } from './utils/magicLink';
import { installOfflineSyncCoordinator } from './lib/offlineSyncCoordinator';

import { isLocalNetworkHost } from './lib/networkDetection';
import { getDeploymentMode, isFieldRuntime } from './domain/deploymentMode';
import { shouldAutoApplyPwaUpdate } from './lib/pwaUpdatePolicy';

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isPublicDisplayHost = hostname === 'display.surfjudging.cloud';
const isLocalLanHost = isLocalNetworkHost();
const deploymentMode = getDeploymentMode();

if (deploymentMode === 'cloud' && !isLocalLanHost && !isPublicDisplayHost) {
  const pendingUpdateKey = 'surfjudging-pwa-update-pending';
  let safeUpdatePoll: number | null = null;

  const applyWaitingUpdateWhenSafe = () => {
    if (!shouldAutoApplyPwaUpdate(window.location.pathname)) {
      try {
        sessionStorage.setItem(pendingUpdateKey, 'true');
      } catch { /* best effort diagnostic */ }

      if (safeUpdatePoll === null) {
        safeUpdatePoll = window.setInterval(() => {
          if (shouldAutoApplyPwaUpdate(window.location.pathname)) {
            window.clearInterval(safeUpdatePoll!);
            safeUpdatePoll = null;
            try {
              sessionStorage.removeItem(pendingUpdateKey);
            } catch { /* best effort diagnostic */ }
            void updateSW(true);
          }
        }, 1000);
      }
      console.info('🔄 Nouvelle version prête — activation différée pour protéger l’écran opérationnel');
      return;
    }

    try {
      sessionStorage.removeItem(pendingUpdateKey);
    } catch { /* best effort diagnostic */ }
    void updateSW(true);
  };

  const updateSW = registerSW({
    onNeedRefresh() {
      applyWaitingUpdateWhenSafe();
    },
    onOfflineReady() {
      console.log('✅ App ready to work offline');
    },
  });
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
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
  if (!isFieldRuntime() && deploymentMode === 'cloud' && !isLocalLanHost) {
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
  installOfflineSyncCoordinator();

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
