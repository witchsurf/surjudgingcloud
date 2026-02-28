import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// Ensure heat helpers (including global getHeatIdentifiers fallback) are loaded before app bootstrap.
import './utils/heat';
import { initStorageCleanup } from './utils/secureStorage';
import { processMagicLinkCallback } from './utils/magicLink';

// Bootstrap: await magic-link session before mounting the app to avoid race conditions
async function bootstrap() {
  // CRITICAL: Wait for magic-link callback to establish the session BEFORE rendering.
  // Without this, the app renders with user=null, effects fire, and navigation redirects
  // the user away from /my-events before the session is ready.
  try {
    await processMagicLinkCallback();
  } catch (err) {
    console.error('Magic link callback error during bootstrap:', err);
  }

  // Initialize secure storage cleanup on app load
  initStorageCleanup();

  if (typeof window !== 'undefined' && import.meta.env.DEV) {
    const resetFlagKey = 'surfapp_dev_bootstrap';
    try {
      if (!sessionStorage.getItem(resetFlagKey)) {
        const keysToClear = [
          'eventData',
          'eventId',
          'participants',
          'heats',
          'surfJudgingConfig',
          'surfJudgingConfigSaved',
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
