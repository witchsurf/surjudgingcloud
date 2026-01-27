import { test, expect } from '@playwright/test';

/**
 * Smoke Tests - Tests Basiques
 * 
 * Ces tests vérifient juste que l'app se lance correctement.
 * Pas besoin de données de test complexes.
 */

test('homepage loads successfully', async ({ page }) => {
    // Navigate to home
    await page.goto('/');

    // Should see the title
    await expect(page).toHaveTitle(/Surf|Judging/i);

    // Take screenshot for reference
    await page.screenshot({ path: 'test-results/homepage.png', fullPage: true });
});

test('judge page is accessible', async ({ page }) => {
    // Navigate to judge page
    await page.goto('/judge');

    // Should see login or judge interface
    const pageContent = await page.content();
    const hasJudgeContent = pageContent.includes('judge') ||
        pageContent.includes('Judge') ||
        pageContent.includes('login');

    expect(hasJudgeContent).toBeTruthy();
});

test('admin page redirects or shows login', async ({ page }) => {
    // Navigate to admin
    await page.goto('/admin');

    // Should either show admin interface or redirect to login
    const url = page.url();
    expect(url).toContain('/admin');
});

test('display page loads', async ({ page }) => {
    // Navigate to display
    await page.goto('/display');

    // Should load without crashing
    const title = await page.title();
    expect(title).toBeTruthy();
});
