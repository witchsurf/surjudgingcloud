import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateUuidV4, UUID_V4_REGEX } from '../uuid';

const originalCrypto = globalThis.crypto;

afterEach(() => {
  if (originalCrypto) {
    Object.defineProperty(globalThis, 'crypto', {
      value: originalCrypto,
      configurable: true,
    });
  }
  vi.restoreAllMocks();
});

describe('field UUID compatibility helper', () => {
  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => '123e4567-e89b-42d3-a456-426614174000');
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID, getRandomValues: vi.fn() },
      configurable: true,
    });

    const result = generateUuidV4();

    expect(result).toBe('123e4567-e89b-42d3-a456-426614174000');
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to cryptographic random bytes when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.set([
        0x12, 0x3e, 0x45, 0x67,
        0xe8, 0x9b,
        0x12, 0xd3,
        0x24, 0x56,
        0x42, 0x66, 0x14, 0x17, 0x40, 0x00,
      ]);
      return array;
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
    });

    const result = generateUuidV4();

    expect(result).toMatch(UUID_V4_REGEX);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
  });

  it('always returns a valid v4 UUID', () => {
    const realGetRandomValues = originalCrypto?.getRandomValues?.bind(originalCrypto);
    const getRandomValues = vi.fn((array: Uint8Array) => {
      if (!realGetRandomValues) throw new Error('getRandomValues unavailable in test runtime');
      realGetRandomValues(array);
      return array;
    });
    Object.defineProperty(globalThis, 'crypto', {
      value: { getRandomValues },
      configurable: true,
    });

    expect(generateUuidV4()).toMatch(UUID_V4_REGEX);
  });
});
