import { afterEach, describe, expect, it } from 'vitest';
import { getFieldRuntimeAnonKey } from '../fieldRuntimeConfig';

describe('Field runtime configuration', () => {
  afterEach(() => { delete window.__SURFJUDGING_RUNTIME_CONFIG__; });

  it('reads the runtime-specific anonymous key without persisting it', () => {
    window.__SURFJUDGING_RUNTIME_CONFIG__ = { anonKey:'a'.repeat(64) };
    expect(getFieldRuntimeAnonKey()).toBe('a'.repeat(64));
  });

  it('fails closed when the injected value is missing or malformed', () => {
    expect(getFieldRuntimeAnonKey()).toBeUndefined();
    window.__SURFJUDGING_RUNTIME_CONFIG__ = { anonKey:'short' };
    expect(getFieldRuntimeAnonKey()).toBeUndefined();
  });
});

