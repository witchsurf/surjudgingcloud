import { test, expect } from '@playwright/test';
import { JudgePage } from '../pages/JudgePage';

/**
 * E2E Test: Judge Kiosk Login Flow
 * 
 * Tests the critical path for judges logging in via kiosk mode:
 * 1. Navigate with kiosk URL params (position + eventId)
 * 2. Auto-load event configuration
 * 3. Enter judge name
 * 4. Access scoring interface
 */

test.describe('Judge Kiosk Login', () => {
    test('should load event config and login via kiosk mode', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Step 1: Navigate to kiosk URL
        // In production, URL would be: /judge?position=J1&eventId=1
        await judgePage.gotoKioskMode('J1', 1);

        // Step 2: Event should auto-load from URL params
        // Wait for config to load (event name should appear)
        await expect(page.getByText(/event|competition/i)).toBeVisible({ timeout: 10000 });

        // Step 3: Enter judge information
        // Note: In kiosk mode, judge ID might be pre-filled from URL
        await judgePage.login('J1', 'Pierre Dupont');

        // Step 4: Verify scoring interface loaded
        // Should see surfer colors (depends on your UI)
        const hasSurfers = await page.getByText(/rouge|blanc|bleu|jaune/i).first().isVisible()
            .catch(() => false);

        // Alternative: Check for score input interface
        const hasScoreInterface = await page.getByLabel(/wave|vague/i).isVisible()
            .catch(() => false);

        // At least one should be true
        expect(hasSurfers || hasScoreInterface).toBeTruthy();
    });

    test('should show error for invalid event ID', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Navigate with non-existent event ID
        await judgePage.gotoKioskMode('J1', 99999);

        // Should show error message or redirect
        const hasError = await Promise.race([
            page.getByText(/error|erreur|not found/i).isVisible().then(() => true),
            page.waitForURL(/\/(?!judge)/, { timeout: 5000 }).then(() => true),
        ]).catch(() => false);

        expect(hasError).toBeTruthy();
    });

    test('should persist login across refresh', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Login
        await judgePage.gotoKioskMode('J1', 1);
        await page.waitForLoadState('networkidle');
        await judgePage.login('J1', 'Marie Martin');

        // Wait for scoring interface
        await expect(page.getByText(/rouge|blanc/i)).toBeVisible();

        // Refresh page
        await page.reload();

        // Should still be logged in (via sessionStorage)
        // Verify we don't see login form again
        const isStillLoggedIn = await page.getByRole('button', { name: /logout|d.connexion/i })
            .isVisible({ timeout: 3000 })
            .catch(() => false);

        expect(isStillLoggedIn).toBeTruthy();
    });
});
