/**
 * Auth Store (Zustand)
 * 
 * Manages judge authentication state with session persistence.
 * Replaces the old AuthContext for better performance.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import * as Sentry from '@sentry/react';

interface Judge {
    id: string;
    name: string;
    identityId?: string;
    stationId?: string;
}

interface AuthStore {
    // State
    currentJudge: Judge | null;

    // Computed
    isAuthenticated: boolean;

    // Actions
    login: (judgeId: string, judgeName: string, judgeIdentityId?: string, stationId?: string) => void;
    logout: () => void;
}

export const useAuthStore = create<AuthStore>()(
    persist(
        (set, get) => ({
            // Initial state
            currentJudge: null,

            // Computed property
            get isAuthenticated() {
                return !!get().currentJudge;
            },

            // Actions
            login: (judgeId: string, judgeName: string, judgeIdentityId?: string, stationId?: string) => {
                const judge = { id: judgeId, name: judgeName, identityId: judgeIdentityId, stationId };
                set({ currentJudge: judge });

                // Set Sentry user context
                try {
                    Sentry.setUser({
                        id: judgeIdentityId || judgeId,
                        username: judgeName,
                    });
                } catch {
                    console.debug('Sentry user context not available');
                }
            },

            logout: () => {
                set({ currentJudge: null });

                // Clear Sentry user context
                try {
                    Sentry.setUser(null);
                } catch {
                    console.debug('Sentry user context not available');
                }
            },
        }),
        {
            name: 'surfJudgingCurrentJudge', // SessionStorage key (same as before)
            storage: createJSONStorage(() => sessionStorage),
        }
    )
);

// Export type for components
export type { Judge };
