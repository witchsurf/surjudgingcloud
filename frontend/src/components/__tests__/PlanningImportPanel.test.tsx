import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlanningImportPanel from '../PlanningImportPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { parsePlanningXlsx, preflight, persistPlanningImportSafely } = vi.hoisted(() => ({
  preflight: vi.fn(),
  persistPlanningImportSafely: vi.fn(),
  parsePlanningXlsx: vi.fn(async (_input: unknown, options: { workbookName: string; worksheetName?: string }) => {
    const rows = [
      { category: 'OPEN', seed: 1, name: 'A', country: 'SEN', license: '001', sourceRow: 2 },
      { category: 'OPEN', seed: 2, name: 'B', country: null, license: null, sourceRow: 3 },
    ];
    if (!options.worksheetName) {
      return {
        validRows: [], warnings: [],
        errors: [{ severity: 'error', code: 'WORKSHEET_SELECTION_REQUIRED', message: 'Sélection requise', sourceRow: null, column: null }],
        input: null,
        metadata: { workbookName: options.workbookName, worksheetName: null, availableWorksheets: ['Notes', 'OPEN'] },
      };
    }
    return {
      validRows: rows, warnings: [], errors: [],
      input: { eventId: '', participants: rows, source: 'xlsx', sourceName: options.workbookName },
      metadata: { workbookName: options.workbookName, worksheetName: options.worksheetName, availableWorksheets: ['Notes', 'OPEN'] },
    };
  }),
}));

vi.mock('../../adapters/planningImport/xlsxParser', () => ({ parsePlanningXlsx }));
vi.mock('../../repositories/PlanningSafetyRepository', () => ({
  planningSafetyRepository: { preflight },
}));
vi.mock('../../services/persistPlanningImportSafely', () => ({ persistPlanningImportSafely }));

describe('PlanningImportPanel preview-only flow', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    preflight.mockReset();
    persistPlanningImportSafely.mockReset();
  });

  const renderPanel = () => act(() => root.render(<PlanningImportPanel />));
  const selectFile = async (name: string, content: string) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([content], name)] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes(label));
    expect(button).toBeTruthy();
    await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  };

  it('parses CSV, displays participants and generates an in-memory bracket', async () => {
    renderPanel();
    await selectFile('participants.csv', 'CATEGORY,SEED,NAME,CLUB,LICENCE\nOPEN,1,A,SEN,001\nOPEN,2,B,,');
    expect(container.textContent).toContain('VALID');
    expect(container.textContent).toContain('OPEN — 2 participants');
    expect(container.textContent).toContain('Club / Pays');
    await click('Générer les previews');
    expect(container.textContent).toContain('PREVIEW_READY');
    expect(container.textContent).toContain('Prévisualisation des heats');
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('blocks bracket preview when canonical input is null', async () => {
    renderPanel();
    await selectFile('invalid.csv', 'CATEGORY,SEED,NAME\nOPEN,abc,A');
    expect(container.textContent).toContain('INVALID');
    expect(container.textContent).toContain('seed invalide');
    expect(container.textContent).not.toContain('Générer la preview en mémoire');
  });

  it('loads XLSX on selection and asks for one worksheet without merging sheets', async () => {
    renderPanel();
    await selectFile('multi.xlsx', 'fake-xlsx');
    expect(container.textContent).toContain('Sélectionnez un onglet');
    const select = container.querySelector('select[aria-label="Sélectionnez un onglet"]') as HTMLSelectElement;
    await act(async () => {
      select.value = 'OPEN';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(parsePlanningXlsx).toHaveBeenLastCalledWith(expect.any(ArrayBuffer), {
      workbookName: 'multi.xlsx', worksheetName: 'OPEN',
    });
    expect(container.textContent).toContain('VALID');
    expect(container.textContent).toContain('OPEN — 2 participants');
  });

  it('does not invoke browser persistence or network for the local CSV preview', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    renderPanel();
    await selectFile('offline.csv', 'CATEGORY,SEED,NAME\nOPEN,1,A\nOPEN,2,B');
    await click('Générer les previews');
    expect(container.textContent).toContain('PREVIEW_READY');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
  });

  it('shows SAFE after an empty server preflight', async () => {
    preflight.mockResolvedValueOnce({ state: 'SAFE', targetedHeats: [] });
    await act(async () => root.render(<PlanningImportPanel eventId={42} />));
    await selectFile('safe.csv', 'CATEGORY,SEED,NAME\nOPEN,1,A\nOPEN,2,B');
    await click('Générer les previews');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(preflight).toHaveBeenCalledWith({ eventId: 42, category: 'OPEN', proposedHeatIds: [], overwrite: true });
    expect(container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent).toContain('SAFE');
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows blocker inventory and never turns a failed preflight into SAFE', async () => {
    preflight.mockResolvedValueOnce({
      state: 'BLOCKED',
      targetedHeats: [{
        heatId: 'heat-1', status: 'closed', isActive: false,
        scoreCount: 3, overrideCount: 1, interferenceCount: 1, judgeAssignmentCount: 3,
        timerCount: 1, historyCount: 1, activePointerCount: 1,
        blockerReasons: ['scores', 'score_overrides', 'status:closed'],
      }],
    });
    await act(async () => root.render(<PlanningImportPanel eventId={42} />));
    await selectFile('blocked.csv', 'CATEGORY,SEED,NAME\nOPEN,1,A\nOPEN,2,B');
    await click('Générer les previews');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const safety = container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent;
    expect(safety).toContain('BLOCKED');
    expect(safety).toContain('heat-1');
    expect(safety).toContain('scores: 3');
    expect(safety).toContain('score_overrides');
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('maps a preflight network error to UNKNOWN, never SAFE', async () => {
    preflight.mockRejectedValueOnce(new Error('réseau indisponible'));
    await act(async () => root.render(<PlanningImportPanel eventId={42} />));
    await selectFile('unknown.csv', 'CATEGORY,SEED,NAME\nOPEN,1,A\nOPEN,2,B');
    await click('Générer les previews');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const safety = container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent;
    expect(safety).toContain('UNKNOWN');
    expect(safety).toContain('réseau indisponible');
    expect(safety).not.toContain('SAFE');
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(true);
  });

  const prepareSafePlanning = async () => {
    preflight.mockResolvedValueOnce({ state: 'SAFE', targetedHeats: [{
      heatId: 'old-clean', status: 'open', isActive: false,
      scoreCount: 0, overrideCount: 0, interferenceCount: 0, judgeAssignmentCount: 0,
      timerCount: 0, historyCount: 0, activePointerCount: 0, blockerReasons: [],
    }] });
    await act(async () => root.render(<PlanningImportPanel eventId={42} eventName="Competition Test" />));
    await selectFile('safe.csv', 'CATEGORY,SEED,NAME\nOPEN,1,A\nOPEN,2,B');
    await click('Générer les previews');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  };

  it('shows the complete operator confirmation before persisting', async () => {
    await prepareSafePlanning();
    await click('Créer les heats sur cet événement');
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Competition Test');
    expect(dialog?.textContent).toContain('Participants');
    expect(dialog?.textContent).toContain('PreflightSAFE');
    expect(dialog?.textContent).toContain('Heats ciblés1');
    expect(dialog?.textContent).toContain('Les heats préparatoires existants');
    expect(persistPlanningImportSafely).not.toHaveBeenCalled();
  });

  it('persists once, disables concurrent submission and reports success', async () => {
    let release!: () => void;
    persistPlanningImportSafely.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    await prepareSafePlanning();
    await click('Créer les heats sur cet événement');
    const confirm = [...container.querySelectorAll('button')].find((node) => node.textContent?.includes('Confirmer et créer'))!;
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    // Only 1 category in this test so 1 call
    expect(persistPlanningImportSafely).toHaveBeenCalledTimes(1);
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(); await Promise.resolve(); });
    expect(container.textContent).toContain('Planning créé avec succès');
    expect(persistPlanningImportSafely).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 42, eventName: 'Competition Test', category: 'OPEN', overwrite: true,
    }));
  });

  it('fails closed with a clear old-server message and preserves the preview', async () => {
    persistPlanningImportSafely.mockRejectedValueOnce({ code: 'PGRST202', message: 'RPC missing' });
    await prepareSafePlanning();
    await click('Créer les heats sur cet événement');
    await click('Confirmer et créer');
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('Le serveur local doit être mis à jour');
    expect(container.textContent).toContain('Prévisualisation des heats');
    expect(persistPlanningImportSafely).toHaveBeenCalledTimes(1);
  });

  it('maps a concurrent server blocker to BLOCKED without losing the preview', async () => {
    persistPlanningImportSafely.mockRejectedValueOnce({ message: 'HEAT_PLANNING_BLOCKED', details: '[scores]' });
    await prepareSafePlanning();
    await click('Créer les heats sur cet événement');
    await click('Confirmer et créer');
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="planning-safety-preflight"]')?.textContent).toContain('BLOCKED');
    expect(container.textContent).toContain('Relancez le contrôle');
    expect(container.textContent).toContain('Prévisualisation des heats');
    expect((container.querySelector('[data-testid="persist-planning-button"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('allows persistence without Internet when the local preflight is SAFE', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    persistPlanningImportSafely.mockResolvedValueOnce(undefined);
    await prepareSafePlanning();
    await click('Créer les heats sur cet événement');
    await click('Confirmer et créer');
    await act(async () => { await Promise.resolve(); });
    expect(persistPlanningImportSafely).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Planning créé avec succès');
  });
});
