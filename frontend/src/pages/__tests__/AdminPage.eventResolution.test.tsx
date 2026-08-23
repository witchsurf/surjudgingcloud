import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminPage from '../AdminPage';
import { useConfigStore } from '../../stores/configStore';
import { useJudgingStore } from '../../stores/judgingStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/supabase')>();
  const createQueryMock = () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
      catch: (reject: any) => Promise.resolve({ data: [], error: null }).catch(reject),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      single: () => Promise.resolve({ data: null, error: null }),
    };
    return chain;
  };

  return {
    ...actual,
    supabase: {
      getChannels: () => [],
      channel: () => ({
        on: () => ({
          subscribe: () => ({
            unsubscribe: vi.fn(),
          }),
        }),
        subscribe: () => ({
          unsubscribe: vi.fn(),
        }),
        unsubscribe: vi.fn(),
      }),
      rpc: vi.fn(async () => ({ data: { checked_at: new Date().toISOString() }, error: null })),
      from: () => createQueryMock(),
    },
    isSupabaseConfigured: () => true,
    isLocalSupabaseMode: () => true,
    canUseSupabaseConnection: () => true,
    getSupabaseMode: () => 'local',
    getSupabaseConfig: () => ({ supabaseUrl: 'http://127.0.0.1:18400', supabaseAnonKey: 'mock-key', mode: 'local' }),
  };
});

vi.mock('../../repositories/EventRepository', () => {
  class MockEventRepository {
    async fetchEvent(eventId: number) {
      if (eventId === 10006) {
        return { id: 10006, name: 'P38-FULL62-Test', organizer: 'P38', status: 'paid' };
      }
      return null;
    }
    async fetchEventConfigSnapshot() {
      return null;
    }
    async fetchDistinctDivisions() {
      return ['OPEN', 'BENJAMIN'];
    }
  }
  return {
    EventRepository: MockEventRepository,
    eventRepository: new MockEventRepository(),
  };
});

vi.mock('../../api/modules/heats.api', () => ({
  fetchAllEventCategories: vi.fn(async () => ['OPEN', 'BENJAMIN']),
  fetchHeatBySchedule: vi.fn(async () => null),
  fetchHeatEntriesWithParticipants: vi.fn(async () => []),
  fetchHeatMetadata: vi.fn(async () => null),
  fetchHeatSlotMappings: vi.fn(async () => []),
  fetchOrderedHeatSequence: vi.fn(async () => []),
  fetchPodiumJudgePanel: vi.fn(async () => null),
  upsertHeatRealtimeConfig: vi.fn(async () => undefined),
}));

describe('AdminPage Event 10006 resolution and crash safety', () => {
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
  });

  it('renders AdminPage without ReferenceError for Event 10006', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/admin?eventId=10006']}>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Verify container rendered interface without crashing
    expect(container.innerHTML).not.toContain('ReferenceError');
    expect(container.innerHTML).not.toContain('Something went wrong');
  });
});
