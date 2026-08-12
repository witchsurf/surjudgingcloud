import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('AdminInterface — contrat localStorage après SAVE canonique', () => {
  it('n’écrit configSaved=true qu’après la résolution de onConfigSaved', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');
    const handler = source.slice(
      source.indexOf('const handleSaveConfig = async () =>'),
      source.indexOf('const handleTimerStart = async () =>'),
    );

    const canonicalAwait = handler.indexOf('await onConfigSaved(true');
    const persistedTrue = handler.indexOf("localStorage.setItem('surfJudgingConfigSaved', 'true')");
    const recoverySnapshot = handler.indexOf("localStorage.setItem('surfJudgingConfig', JSON.stringify(config))");

    expect(canonicalAwait).toBeGreaterThanOrEqual(0);
    expect(persistedTrue).toBeGreaterThan(canonicalAwait);
    expect(recoverySnapshot).toBeGreaterThan(persistedTrue);
  });

  it('écrit configSaved=false et rend une erreur opérateur visible sur rejet canonique', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/AdminInterface.tsx'), 'utf8');
    const handler = source.slice(
      source.indexOf('const handleSaveConfig = async () =>'),
      source.indexOf('const handleTimerStart = async () =>'),
    );

    expect(handler).toContain("localStorage.setItem('surfJudgingConfigSaved', 'false')");
    expect(handler).toContain('setSyncError(message)');
    expect(handler).toContain('alert(`Sauvegarde impossible : ${message}`)');
  });
});
