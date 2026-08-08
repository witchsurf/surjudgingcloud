import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import PlanningImportPanel from '../PlanningImportPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixturePath = process.env.REAL_COMPETITION_X_XLSX;

describe.runIf(Boolean(fixturePath))('PlanningImportPanel with Competition X', () => {
  it('parses and previews the unchanged field workbook offline without persistence', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    const storageSpy = vi.spyOn(Storage.prototype, 'setItem');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    try {
      await act(async () => root.render(<PlanningImportPanel />));
      const bytes = readFileSync(fixturePath!);
      const file = new File([new Uint8Array(bytes)], 'Competition X.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      await act(async () => {
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      expect(container.textContent).toContain('VALID');
      expect(container.textContent).toContain('Competition X.xlsx');
      expect(container.textContent).toContain('Feuil1');
      expect(container.textContent).toContain('62');
      expect(container.textContent).toContain('7');
      expect(container.textContent).toContain('8');
      expect(container.textContent).toContain('OPEN — 20 participants');
      expect(container.textContent).toContain('CADET — 13 participants');

      const button = [...container.querySelectorAll('button')]
        .find((node) => node.textContent?.includes('Générer la preview en mémoire'));
      await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(container.textContent).toContain('PREVIEW_READY');
      expect(container.textContent).toContain('Prévisualisation des heats');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(storageSpy).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
