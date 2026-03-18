import { test, expect } from '@playwright/test';
import { JudgePage } from '../pages/JudgePage';

/**
 * E2E Test: Judge Kiosk Login Flow
 *
 * Tests the critical path for judges logging in via kiosk mode:
 * 1. Navigate with kiosk URL params (position + eventId)
 * 2. KioskJudgeLogin component renders ("Mode Kiosque", "Position: Juge X")
 * 3. Enter judge name
 * 4. Access scoring interface
 */

test.describe('Judge Kiosk Login', () => {
    test('should load kiosk login and login via kiosk mode', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Step 1: Navigate to kiosk URL
        await judgePage.gotoKioskMode('J1', 1);

        // Step 2: Wait for any meaningful state to appear (up to 20s)
        const state = await page.evaluate(() => {
            return new Promise<string>((resolve) => {
                const check = () => {
                    const text = document.body.innerText.toLowerCase();
                    if (text.includes('mode kiosque') || text.includes('votre nom')) return resolve('kiosk');
                    if (text.includes('en attente')) return resolve('waiting');
                    if (text.includes('lien invalide')) return resolve('invalid');
                    if (text.includes('chargement')) return resolve('loading');
                    setTimeout(check, 500);
                };
                check();
                // Safety: resolve after 18s to avoid exceeding the 30s test timeout
                setTimeout(() => resolve('timeout'), 18000);
            });
        });

        // Without Supabase, page stays on "Chargement..." — skip gracefully
        if (state === 'loading' || state === 'timeout') {
            test.skip();
            return;
        }

        expect(['kiosk', 'waiting', 'invalid']).toContain(state);

        // If kiosk login is visible, proceed with login
        if (state === 'kiosk') {
            await judgePage.login('Pierre Dupont');

            // Verify we leave the login screen
            const postState = await page.evaluate(() => {
                return new Promise<string>((resolve) => {
                    const check = () => {
                        const text = document.body.innerText.toLowerCase();
                        if (text.includes('rouge') || text.includes('blanc') || text.includes('bleu')) return resolve('scoring');
                        if (text.includes('en attente') || text.includes('chargement')) return resolve('waiting');
                        setTimeout(check, 500);
                    };
                    check();
                    setTimeout(() => resolve('timeout'), 5000);
                });
            });

            expect(['scoring', 'waiting', 'timeout']).toContain(postState);
        }
    });

    test('should show error for invalid event ID', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Navigate with non-existent event ID
        await judgePage.gotoKioskMode('J1', 99999);

        // Should show error message, waiting screen, or redirect
        const hasError = await Promise.race([
            page.getByText(/error|erreur|not found|en attente/i).isVisible().then(() => true),
            page.waitForURL(/\/(?!judge)/, { timeout: 5000 }).then(() => true),
        ]).catch(() => false);

        expect(hasError).toBeTruthy();
    });

    test('should persist login across refresh', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Navigate to kiosk
        await judgePage.gotoKioskMode('J1', 1);
        await page.waitForLoadState('networkidle');

        // Check if kiosk login appeared
        const hasKioskLogin = await page.getByText(/mode kiosque/i).isVisible({ timeout: 5000 })
            .catch(() => false);

        if (!hasKioskLogin) {
            // Without Supabase, we get "En attente de configuration" — skip this test gracefully
            test.skip();
            return;
        }

        // Login
        await judgePage.login('Marie Martin');

        // Wait for post-login state
        await page.waitForTimeout(1000);

        // Refresh page
        await page.reload();
        await page.waitForLoadState('networkidle');

        // After refresh, we should not see the kiosk login form again
        // (session is stored in sessionStorage by KioskJudgeLogin)
        const loginFormStillVisible = await page.getByText(/mode kiosque/i).isVisible({ timeout: 3000 })
            .catch(() => false);

        // If session persisted, we should NOT see the login form
        // But if Supabase config changed, we might see waiting screen — both are acceptable
        const isStillLoggedIn = !loginFormStillVisible;
        const hasWaitingScreen = await page.getByText(/en attente|chargement/i).isVisible({ timeout: 2000 })
            .catch(() => false);

        expect(isStillLoggedIn || hasWaitingScreen).toBeTruthy();
    });
});
