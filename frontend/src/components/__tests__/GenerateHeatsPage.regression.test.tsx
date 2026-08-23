import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';
import GenerateHeatsPage from '../GenerateHeatsPage';
import { useConfigStore } from '../../stores/configStore';
import { participantRepository } from '../../repositories/ParticipantRepository';
import { categoryPlanningPolicyRepository } from '../../repositories/CategoryPlanningPolicyRepository';
import { heatPlanningRepository } from '../../repositories/HeatPlanningRepository';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../repositories/ParticipantRepository', () => ({
  participantRepository: {
    listByEvent: vi.fn(),
  },
}));

vi.mock('../../repositories/CategoryPlanningPolicyRepository', () => ({
  categoryPlanningPolicyRepository: {
    list: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('../../repositories/HeatPlanningRepository', () => ({
  heatPlanningRepository: {
    createWithEntries: vi.fn(),
  },
}));

vi.mock('../../repositories/EventRepository', () => ({
  eventRepository: {
    saveEventConfigSnapshot: vi.fn(async () => {}),
  },
}));

vi.mock('../../repositories/ActiveHeatPointerRepository', () => ({
  activeHeatPointerRepository: {
    upsert: vi.fn(async () => {}),
  },
}));

vi.mock('../../repositories/HeatRepository', () => ({
  heatRepository: {
    saveConfiguration: vi.fn(async () => {}),
  },
}));

vi.mock('../../lib/supabase', () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    from: vi.fn((table: string) => {
      if (table === 'events') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({
            data: { id: 10006, name: 'P38-FULL62-Test', paid: true, status: 'ready' },
            error: null,
          })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({
          data: {
            id: 'heat-123',
            event_id: 10006,
            category: 'OPEN',
            round: 1,
            heat_number: 1,
            status: 'OPEN',
            heat_size: 4,
            is_completed: false,
            color_order: []
          },
          error: null
        })),
      };
    }),
  },
}));

describe('GenerateHeatsPage & configStore regression', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('eventData', JSON.stringify({ eventDbId: 10006, name: 'P38-FULL62-Test' }));
    localStorage.setItem('surfJudgingActiveEventId', '10006');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container) {
      container.remove();
    }
    container = null;
    root = null;
  });

  it('configStore.saveConfigToDb executes without heatRepository ReferenceError', async () => {
    const { saveConfigToDb } = useConfigStore.getState();
    await expect(
      saveConfigToDb(10006, {
        competition: 'P38-FULL62-Test',
        division: 'OPEN',
        round: 3,
        heatId: 1,
        judges: ['J1', 'J2', 'J3'],
        surfers: ['ROUGE', 'BLANC'],
        waves: 15,
        tournamentType: 'elimination',
      } as any)
    ).resolves.not.toThrow();
  });

  it('GenerateHeatsPage loads server policies and renders OPEN Man-on-Man transition', async () => {
    vi.mocked(participantRepository.listByEvent).mockResolvedValue([
      { id: 'p1', eventId: 10006, category: 'OPEN', seed: 1, name: 'Surfer 1', country: 'FR' },
      { id: 'p2', eventId: 10006, category: 'OPEN', seed: 2, name: 'Surfer 2', country: 'FR' },
      { id: 'p3', eventId: 10006, category: 'OPEN', seed: 3, name: 'Surfer 3', country: 'FR' },
      { id: 'p4', eventId: 10006, category: 'OPEN', seed: 4, name: 'Surfer 4', country: 'FR' },
    ] as any);

    vi.mocked(categoryPlanningPolicyRepository.list).mockResolvedValue([
      {
        event_id: 10006,
        category: 'OPEN',
        base_format: 'elimination',
        transition_round: 2,
        transition_format: 'man_on_man',
        version: 1,
      },
    ]);

    vi.mocked(heatPlanningRepository.createWithEntries).mockResolvedValue({ heats: [], entries: [] } as any);
    vi.mocked(categoryPlanningPolicyRepository.upsert).mockResolvedValue({} as any);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/generate-heats?eventId=10006']}>
          <Routes>
            <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    expect(categoryPlanningPolicyRepository.list).toHaveBeenCalledWith(10006);
    expect(container?.textContent).toContain('Catégorie OPEN');
  });
});
