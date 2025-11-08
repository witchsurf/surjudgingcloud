import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './index.css';

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
    <RouterProvider router={router} />
  </StrictMode>
);
