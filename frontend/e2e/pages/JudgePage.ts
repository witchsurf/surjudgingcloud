import { Page, Locator } from '@playwright/test';

/**
 * Page Object for Judge Interface
 *
 * Covers both login flows:
 * - Kiosk mode (/judge?position=J1&eventId=1) → KioskJudgeLogin (label "Votre Nom", button "Commencer à Juger")
 * - Legacy mode (/judge?judge_id=xxx) → JudgeLogin (label "Code Personnel", button "Se Connecter")
 */
export class JudgePage {
    readonly page: Page;

    // Kiosk login locators (primary flow)
    readonly judgeNameInput: Locator;
    readonly kioskLoginButton: Locator;

    // Legacy login locators (fallback)
    readonly personalCodeInput: Locator;
    readonly legacyLoginButton: Locator;

    // Post-login
    readonly logoutButton: Locator;

    constructor(page: Page) {
        this.page = page;

        // Kiosk mode: KioskJudgeLogin component
        this.judgeNameInput = page.getByLabel(/nom/i);
        this.kioskLoginButton = page.getByRole('button', { name: /commencer|juger/i });

        // Legacy mode: JudgeLogin component
        this.personalCodeInput = page.getByLabel(/code personnel/i);
        this.legacyLoginButton = page.getByRole('button', { name: /connecter/i });

        // Post-login
        this.logoutButton = page.getByRole('button', { name: /logout|déconnexion/i });
    }

    /**
     * Navigate to judge page with kiosk mode params
     */
    async gotoKioskMode(position: string, eventId: number) {
        await this.page.goto(`/judge?position=${position}&eventId=${eventId}`);
    }

    /**
     * Login as a judge in kiosk mode (only needs name)
     */
    async login(judgeName: string) {
        await this.judgeNameInput.fill(judgeName);
        await this.kioskLoginButton.click();
    }

    /**
     * Login via legacy flow (judge_id + personal code)
     */
    async loginWithCode(code: string) {
        await this.personalCodeInput.fill(code);
        await this.legacyLoginButton.click();
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
