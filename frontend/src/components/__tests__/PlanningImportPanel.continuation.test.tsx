// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../repositories/CategoryPlanningPolicyRepository', () => ({
  categoryPlanningPolicyRepository: {
    list: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../../repositories/PlanningStatusRepository', () => ({
  planningStatusRepository: {
    fetchServerPlanningSummary: vi.fn(),
  },
}));

import PlanningImportPanel from '../PlanningImportPanel';
import { planningStatusRepository } from '../../repositories/PlanningStatusRepository';

describe('PlanningImportPanel Server-Authoritative Continuation UX', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(planningStatusRepository.fetchServerPlanningSummary).mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders normal import workflow when no planning exists on server', async () => {
    vi.mocked(planningStatusRepository.fetchServerPlanningSummary).mockResolvedValue({
      loading: false,
      exists: false,
      heatCount: 0,
      participantCount: 0,
      categories: [],
      policies: {},
    });

    await act(async () => {
      root.render(<PlanningImportPanel eventId={100} eventName="Empty Event" />);
    });
    // Wait for async server check
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(container.textContent).toContain('Nouvel import hors ligne');
    expect(container.textContent).toContain('Fichier local CSV/XLSX');
    expect(container.querySelector('[data-testid="continue-competition-button"]')).toBeNull();
    expect(container.querySelector('[data-testid="persist-planning-button"]')).toBeTruthy();
  });

  it('renders PLANNING EXISTANT and CONTINUER LA COMPÉTITION when heats exist on server', async () => {
    vi.mocked(planningStatusRepository.fetchServerPlanningSummary).mockResolvedValue({
      loading: false,
      exists: true,
      heatCount: 3,
      participantCount: 4,
      categories: ['CADET', 'OPEN'],
      policies: {
        OPEN: { event_id: 100, category: 'OPEN', base_format: 'elimination', transition_round: 3, transition_format: 'man_on_man', version: 1 },
        CADET: { event_id: 100, category: 'CADET', base_format: 'elimination', transition_round: null, transition_format: null, version: 1 },
      },
    });

    await act(async () => {
      root.render(<PlanningImportPanel eventId={100} eventName="Championnat Pro" />);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(container.textContent).toContain('PLANNING EXISTANT');
    expect(container.textContent).toContain('Serveur synchronisé (3 heats)');
    expect(container.textContent).toContain('Championnat Pro');
    expect(container.textContent).toContain('4'); // participants
    expect(container.textContent).toContain('3'); // heats
    expect(container.textContent).toContain('2'); // categories

    // Check policy rendering
    expect(container.textContent).toContain('OPEN');
    expect(container.textContent).toContain('Transition R3 → Man-on-Man');
    expect(container.textContent).toContain('CADET');
    expect(container.textContent).toContain('Sans transition');

    // Primary action
    const continueBtn = container.querySelector('[data-testid="continue-competition-button"]');
    expect(continueBtn).toBeTruthy();
    expect(continueBtn?.textContent).toContain('CONTINUER LA COMPÉTITION');

    // Secondary action
    const regenBtn = container.querySelector('[data-testid="regenerate-planning-button"]');
    expect(regenBtn).toBeTruthy();
    expect(regenBtn?.textContent).toContain('Modifier / Régénérer le planning');
  });

  it('switches to explicit regeneration mode when clicking Modifier / Régénérer', async () => {
    vi.mocked(planningStatusRepository.fetchServerPlanningSummary).mockResolvedValue({
      loading: false,
      exists: true,
      heatCount: 1,
      participantCount: 2,
      categories: ['OPEN'],
      policies: {},
    });

    await act(async () => {
      root.render(<PlanningImportPanel eventId={100} eventName="Championnat Pro" />);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    const regenBtn = container.querySelector('[data-testid="regenerate-planning-button"]') as HTMLButtonElement;
    expect(regenBtn).toBeTruthy();

    await act(async () => {
      regenBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // In regeneration mode, displays explicit regeneration heading, warning, and cancel button
    expect(container.textContent).toContain('Modifier / Régénérer le planning');
    expect(container.textContent).toContain('Régénération explicite');
    expect(container.textContent).toContain('Toute régénération sera soumise au contrôle de sécurité serveur');
    expect(container.textContent).toContain('Annuler et revenir à la compétition');

    // Clicking cancel returns to continuation banner
    const cancelBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Annuler et revenir'));
    expect(cancelBtn).toBeTruthy();
    await act(async () => {
      cancelBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('PLANNING EXISTANT');
  });
});
