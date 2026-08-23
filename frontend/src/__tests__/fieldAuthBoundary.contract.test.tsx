import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { isFieldRuntime, isCloudRuntime } from '../domain/deploymentMode';
import { AuthGuard } from '../components/AuthGuard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const getSessionMock = vi.fn().mockResolvedValue({ data: { session: null } });
const onAuthStateChangeMock = vi.fn().mockReturnValue({
  data: {
    subscription: {
      unsubscribe: vi.fn(),
    },
  },
});

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionMock(),
      onAuthStateChange: (...args: any[]) => onAuthStateChangeMock(...args),
    },
  },
  isSupabaseConfigured: () => true,
  isLocalSupabaseMode: () => false,
}));

describe('P3.8 — Field vs Cloud Auth Boundary Contract', () => {
  const originalMode = import.meta.env.VITE_DEPLOYMENT_MODE;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = originalMode;
    vi.restoreAllMocks();
  });

  describe('isFieldRuntime and isCloudRuntime helpers', () => {
    it('correctly identifies Field mode without multiple hostname heuristics', () => {
      (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = 'field';
      expect(isFieldRuntime()).toBe(true);
      expect(isCloudRuntime()).toBe(false);
    });

    it('correctly identifies Cloud mode', () => {
      (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = 'cloud';
      expect(isFieldRuntime()).toBe(false);
      expect(isCloudRuntime()).toBe(true);
    });
  });

  describe('AuthGuard in Field mode vs Cloud mode', () => {
    it('FIELD + no session => renders /admin protected content immediately without redirect or warnings', async () => {
      (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = 'field';

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/admin']}>
            <Routes>
              <Route
                path="/admin"
                element={
                  <AuthGuard requireAuth={true}>
                    <div id="admin-content">Admin Content Loaded</div>
                  </AuthGuard>
                }
              />
              <Route path="/my-events" element={<div id="my-events-fallback">My Events Page</div>} />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(container.querySelector('#admin-content')).not.toBeNull();
      expect(container.querySelector('#admin-content')?.textContent).toBe('Admin Content Loaded');
      expect(container.querySelector('#my-events-fallback')).toBeNull();
      // Must not log session expired or authentication required warnings
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Authentication required'));
      expect(consoleWarnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Session expired'));
    });

    it('FIELD + no session => operational field routes are accessible without user session', async () => {
      (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = 'field';

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/judge']}>
            <Routes>
              <Route
                path="/judge"
                element={
                  <AuthGuard requireAuth={true}>
                    <div id="judge-content">Judge Content</div>
                  </AuthGuard>
                }
              />
            </Routes>
          </MemoryRouter>
        );
      });

      expect(container.querySelector('#judge-content')).not.toBeNull();
    });

    it('CLOUD + no session => blocks immediate content display', async () => {
      (import.meta.env as Record<string, string>).VITE_DEPLOYMENT_MODE = 'cloud';

      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={['/admin']}>
            <Routes>
              <Route
                path="/admin"
                element={
                  <AuthGuard requireAuth={true}>
                    <div id="admin-content">Admin Content Loaded</div>
                  </AuthGuard>
                }
              />
              <Route path="/my-events" element={<div id="my-events-page">My Events Page</div>} />
            </Routes>
          </MemoryRouter>
        );
      });

      // In Cloud mode without session, admin content is not directly shown
      expect(container.querySelector('#admin-content')).toBeNull();
    });
  });
});
