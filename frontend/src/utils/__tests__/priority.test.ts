import { describe, expect, it } from 'vitest';
import { buildEqualPriorityState, getPriorityLabels, removePrioritySurfer } from '../priority';

describe('priority opening rotation', () => {
  it('moves an already-opened surfer back to the end when they catch another wave', () => {
    const surfers = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'];

    const afterRed = removePrioritySurfer(buildEqualPriorityState(), 'ROUGE');
    const afterWhite = removePrioritySurfer(afterRed, 'BLANC');
    const afterRedAgain = removePrioritySurfer(afterWhite, 'ROUGE');

    expect(afterRedAgain.mode).toBe('opening');
    expect(afterRedAgain.order).toEqual(['BLANC', 'ROUGE']);

    const labels = getPriorityLabels(afterRedAgain, surfers);
    expect(labels.ROUGE).toBe('4');
    expect(labels.BLANC).toBe('3');
    expect(labels.JAUNE).toBe('=');
    expect(labels.BLEU).toBe('=');
  });
});
