import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthoritativeHeatId, type UseAuthoritativeHeatIdParams, type UseAuthoritativeHeatIdResult } from '../../hooks/useAuthoritativeHeatId';
import * as heatsApi from '../../api/modules/heats.api';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../lib/supabase', () => ({
  supabase: {},
  isSupabaseConfigured: () => true,
  isLocalSupabaseMode: () => false,
}));

vi.mock('../../api/modules/heats.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/modules/heats.api')>();
  return {
    ...actual,
    fetchHeatBySchedule: vi.fn(),
    fetchActiveHeatPointer: vi.fn(),
  };
});

function TestHarness(props: {
  params: UseAuthoritativeHeatIdParams;
  onUpdate: (result: UseAuthoritativeHeatIdResult) => void;
}) {
  const result = useAuthoritativeHeatId(props.params);
  useEffect(() => {
    props.onUpdate(result);
  }, [result, props]);
  return null;
}

describe('Downstream Authoritative Heat ID Resolution Contract', () => {
  const DB_OPAQUE_HEAT_ID = 'p38-test2-disposable_open_r1_h1';
  const FORBIDDEN_SYNTHETIC_ID = 'p38_test2_disposable_open_r1_h1';

  let container: HTMLDivElement;
  let root: Root;
  let latestResult: UseAuthoritativeHeatIdResult;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderHarness = async (params: UseAuthoritativeHeatIdParams) => {
    await act(async () => {
      root.render(
        <TestHarness
          params={params}
          onUpdate={(res: UseAuthoritativeHeatIdResult) => {
            latestResult = res;
          }}
        />
      );
    });
  };

  it('initializes with empty string during async resolution to prevent pre-canonical subscriptions', async () => {
    vi.mocked(heatsApi.fetchHeatBySchedule).mockReturnValue(new Promise(() => {})); // Never resolves

    await renderHarness({
      eventId: 10004,
      division: 'OPEN',
      round: 1,
      heatNumber: 1,
      podiumId: 'A',
    });

    // Initial state must be empty string, NEVER synthetic fallback
    expect(latestResult.heatId).toBe('');
    expect(latestResult.heatId).not.toBe(FORBIDDEN_SYNTHETIC_ID);
    expect(latestResult.loading).toBe(true);
  });

  it('resolves exact opaque public.heats.id from schedule without mutation', async () => {
    vi.mocked(heatsApi.fetchHeatBySchedule).mockResolvedValue({
      id: DB_OPAQUE_HEAT_ID,
      event_id: 10004,
      competition: 'P38-Test2-Disposable',
      division: 'OPEN',
      round: 1,
      heat_number: 1,
      heat_size: 4,
      status: 'open',
    } as any);

    await renderHarness({
      eventId: 10004,
      division: 'OPEN',
      round: 1,
      heatNumber: 1,
      podiumId: 'A',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestResult.loading).toBe(false);
    expect(latestResult.heatId).toBe(DB_OPAQUE_HEAT_ID);
    expect(latestResult.heatId).not.toBe(FORBIDDEN_SYNTHETIC_ID);
    expect(latestResult.error).toBeNull();
  });

  it('resolves exact opaque active_heat_id from active_heat_pointer fallback', async () => {
    vi.mocked(heatsApi.fetchHeatBySchedule).mockResolvedValue(null);
    vi.mocked(heatsApi.fetchActiveHeatPointer).mockResolvedValue({
      event_id: 10004,
      podium_id: 'A',
      active_heat_id: DB_OPAQUE_HEAT_ID,
      event_name: 'P38-Test2-Disposable',
    } as any);

    await renderHarness({
      eventId: 10004,
      podiumId: 'A',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestResult.loading).toBe(false);
    expect(latestResult.heatId).toBe(DB_OPAQUE_HEAT_ID);
    expect(latestResult.heatId).not.toBe(FORBIDDEN_SYNTHETIC_ID);
  });

  it('remains empty string if heat is not found and sets error without synthetic generation', async () => {
    vi.mocked(heatsApi.fetchHeatBySchedule).mockResolvedValue(null);
    vi.mocked(heatsApi.fetchActiveHeatPointer).mockResolvedValue(null);

    await renderHarness({
      eventId: 10004,
      division: 'OPEN',
      round: 99,
      heatNumber: 99,
      podiumId: 'A',
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(latestResult.loading).toBe(false);
    expect(latestResult.heatId).toBe('');
    expect(latestResult.heatId).not.toBe(FORBIDDEN_SYNTHETIC_ID);
    expect(latestResult.error).toBe('Heat planifié introuvable');
  });
});
