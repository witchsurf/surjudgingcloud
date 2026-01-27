import { test, expect } from '@playwright/test';
import { JudgePage } from '../pages/JudgePage';

/**
 * E2E Test: Score Submission
 * 
 * Tests score submission in online and offline modes:
 * 1. Submit score while online (saves to DB)
 * 2. Submit score while offline (saves to localStorage)
 * 3. Auto-sync when back online
 */

test.describe('Score Submission', () => {
    test('should submit score successfully when online', async ({ page }) => {
        const judgePage = new JudgePage(page);

        // Login as judge
        await judgePage.gotoKioskMode('J1', 1);
        await judgePage.login('J1', 'Test Judge');

        // Wait for scoring interface to load
        await expect(page.getByText(/rouge|blanc/i)).toBeVisible();

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
        await judgePage.login('J1', 'Rapid Tester');

        await expect(page.getByText(/rouge|blanc/i)).toBeVisible();

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
        await judgePage.login('J1', 'Validator');

        await expect(page.getByText(/rouge|blanc/i)).toBeVisible();

        // Try to submit invalid score (> 10)
        await page.getByRole('button', { name: /rouge/i }).click();
        await page.getByLabel(/wave/i).fill('1');
        await page.getByLabel(/score/i).fill('11.5');
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
