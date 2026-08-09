import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearExpiredItems,
  getStorageInfo,
  initStorageCleanup,
  isStorageAvailable,
  secureGetItem,
  secureRemoveItem,
  secureSetItem,
} from '../secureStorage';

const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

afterEach(() => {
  vi.useRealTimers();
  if (originalDescriptor) Object.defineProperty(window, 'localStorage', originalDescriptor);
});

describe('secureStorage when localStorage is unavailable', () => {
  it('keeps non-critical cache operations non-fatal when access throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new ReferenceError("Can't find variable: localStorage");
      },
    });

    expect(() => secureSetItem('cache', { value: 1 })).not.toThrow();
    expect(secureGetItem('cache')).toBeNull();
    expect(() => secureRemoveItem('cache')).not.toThrow();
    expect(() => clearExpiredItems()).not.toThrow();
    expect(getStorageInfo()).toEqual({ used: 0, available: 0, percentage: 0 });
    expect(isStorageAvailable()).toBe(false);
  });

  it('does not prevent application bootstrap cleanup', () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Access denied', 'SecurityError');
      },
    });

    expect(() => initStorageCleanup()).not.toThrow();
  });
});
