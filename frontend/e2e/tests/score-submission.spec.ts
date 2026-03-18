import { test, expect } from '@playwright/test';
import { JudgePage } from '../pages/JudgePage';

/**
 * E2E Test: Score Submission
 *
 * Tests score submission flows.
 * Note: These tests require a running local Supabase to fully load the scoring interface.
 * Without Supabase, the kiosk shows "En attente de configuration".
 * Tests are written to gracefully skip when Supabase is unavailable.
 */

test.describe('Score Submission', () => {
    test('should submit score successfully when online', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Login as judge via kiosk mode
        await judgePage.gotoKioskMode('J1', 1);

        // Check if kiosk login appeared
        const hasKioskLogin = await page.getByText(/mode kiosque/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasKioskLogin) {
            test.skip();
            return;
        }

        await judgePage.login('Test Judge');

        // Wait for scoring interface to load
        const hasScoringUI = await page.getByText(/rouge|blanc/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasScoringUI) {
            // Config not loaded (no Supabase) — skip gracefully
            test.skip();
            return;
        }

        // Submit a score
        await judgePage.submitScore('ROUGE', 1, 7.5);

        // Should show success notification
        await judgePage.waitForSuccessNotification();

        // Score should appear in the scores list
        const scoreVisible = await page.getByText('7.5').isVisible();
        expect(scoreVisible).toBeTruthy();
    });

    test('should handle rapid score submissions', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Login
        await judgePage.gotoKioskMode('J1', 1);

        const hasKioskLogin = await page.getByText(/mode kiosque/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasKioskLogin) {
            test.skip();
            return;
        }

        await judgePage.login('Rapid Tester');

        const hasScoringUI = await page.getByText(/rouge|blanc/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasScoringUI) {
            test.skip();
            return;
        }

        // Submit multiple scores quickly
        await judgePage.submitScore('ROUGE', 1, 6.0);
        await page.waitForTimeout(500);

        await judgePage.submitScore('BLANC', 1, 7.0);
        await page.waitForTimeout(500);

        await judgePage.submitScore('ROUGE', 2, 8.5);

        // All scores should be saved
        await expect(page.getByText('6.0')).toBeVisible();
        await expect(page.getByText('7.0')).toBeVisible();
        await expect(page.getByText('8.5')).toBeVisible();
    });

    test('should validate score range', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Login
        await judgePage.gotoKioskMode('J1', 1);

        const hasKioskLogin = await page.getByText(/mode kiosque/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasKioskLogin) {
            test.skip();
            return;
        }

        await judgePage.login('Validator');

        const hasScoringUI = await page.getByText(/rouge|blanc/i).isVisible({ timeout: 10000 })
            .catch(() => false);

        if (!hasScoringUI) {
            test.skip();
            return;
        }

        // Try to submit invalid score (> 10)
        await page.getByRole('button', { name: /rouge/i }).click();
        await page.getByLabel(/wave|vague/i).fill('1');
        await page.getByLabel(/score|note/i).fill('11.5');
        await page.getByRole('button', { name: /submit|valider/i }).click();

        // Should show error or prevent submission
        const hasError = await page.getByText(/invalid|invalide|maximum|max/i)
            .isVisible({ timeout: 2000 })
            .catch(() => false);

        const score11Saved = await page.getByText('11.5')
            .isVisible({ timeout: 1000 })
            .catch(() => false);

        // Either shows error OR doesn't save the score
        expect(hasError || !score11Saved).toBeTruthy();
    });
});
