import { Page, Locator } from '@playwright/test';

/**
 * Page Object for Judge Interface
 * 
 * Encapsulates all judge page interactions for cleaner tests
 */
export class JudgePage {
    readonly page: Page;

    // Locators
    readonly judgeIdInput: Locator;
    readonly judgeNameInput: Locator;
    readonly loginButton: Locator;
    readonly logoutButton: Locator;

    constructor(page: Page) {
        this.page = page;

        // Login elements
        this.judgeIdInput = page.getByLabel(/judge id/i);
        this.judgeNameInput = page.getByLabel(/name|nom/i);
        this.loginButton = page.getByRole('button', { name: /login|connexion/i });
        this.logoutButton = page.getByRole('button', { name: /logout|d.connexion/i });
    }

    /**
     * Navigate to judge page with kiosk mode params
     */
    async gotoKioskMode(position: string, eventId: number) {
        await this.page.goto(`/judge?position=${position}&eventId=${eventId}`);
    }

    /**
     * Login as a judge
     */
    async login(judgeId: string, judgeName: string) {
        await this.judgeIdInput.fill(judgeId);
        await this.judgeNameInput.fill(judgeName);
        await this.loginButton.click();
    }

    /**
     * Submit a score for a surfer
     */
    async submitScore(surfer: string, waveNumber: number, score: number) {
        // Click surfer button
        await this.page.getByRole('button', { name: surfer }).click();

        // Fill wave number
        await this.page.getByLabel(/wave|vague/i).fill(waveNumber.toString());

        // Fill score
        await this.page.getByLabel(/score|note/i).fill(score.toString());

        // Submit
        await this.page.getByRole('button', { name: /submit|valider/i }).click();
    }

    /**
     * Wait for success toast/notification
     */
    async waitForSuccessNotification() {
        await this.page.getByText(/sauv|success/i).waitFor({ timeout: 5000 });
    }

    /**
     * Get all submitted scores from UI
     */
    async getScoresFromUI(): Promise<Array<{ surfer: string; wave: number; score: number }>> {
        // This would need to match your actual UI structure
        const scoreElements = await this.page.locator('[data-testid="score-item"]').all();

        return Promise.all(
            scoreElements.map(async (el) => ({
                surfer: await el.getAttribute('data-surfer') || '',
                wave: parseInt(await el.getAttribute('data-wave') || '0'),
                score: parseFloat(await el.getAttribute('data-score') || '0'),
            }))
        );
    }
}
