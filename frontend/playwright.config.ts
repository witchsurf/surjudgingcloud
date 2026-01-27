import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright End-to-End Test Configuration
 * 
 * Tests critical user flows: judge login, score submission, heat progression
 */
export default defineConfig({
    // Test directory
    testDir: './e2e',

    // Test timeout
    timeout: 30 * 1000,

    // Fail fast strategy
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,

    // Reporter
    reporter: 'html',

    // Shared settings
    use: {
        // Base URL
        baseURL: 'http://localhost:5173',

        // Screenshots on failure
        screenshot: 'only-on-failure',

        // Videos on failure
        video: 'retain-on-failure',

        // Trace on first retry
        trace: 'on-first-retry',
    },

    // Configure projects for different browsers
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],

    // Run dev server before tests
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
    },
});
