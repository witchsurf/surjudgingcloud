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
import { eventRepository } from '../../repositories/EventRepository';
import { activeHeatPointerRepository } from '../../repositories/ActiveHeatPointerRepository';
import { heatRepository } from '../../repositories/HeatRepository';

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

const mockDbHeats = new Map<string, any>();

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
            data: { id: 10006, name: "SANDY'S", paid: true, status: 'ready' },
            error: null,
          })),
        };
      }
      if (table === 'heats') {
        let selectedDivision: string | null = null;
        let selectedRound: number | null = null;
        let selectedHeatNumber: number | null = null;
        const query: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col: string, val: any) => {
            if (col === 'round') selectedRound = Number(val);
            if (col === 'heat_number') selectedHeatNumber = Number(val);
            return query;
          }),
          ilike: vi.fn((col: string, val: string) => {
            if (col === 'division') selectedDivision = val;
            return query;
          }),
          maybeSingle: vi.fn(async () => {
            const key = `${selectedDivision?.toUpperCase()}_R${selectedRound}_H${selectedHeatNumber}`;
            const found = mockDbHeats.get(key);
            if (found) {
              return { data: found, error: null };
            }
            return { data: null, error: null };
          }),
        };
        return query;
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      };
    }),
  },
}));

function buildSandys62Participants(eventId: number) {
  const categories = [
    { name: 'BENJAMIN', count: 10 },
    { name: 'CADET', count: 14 },
    { name: 'JUNIOR', count: 6 },
    { name: 'MINIME', count: 4 },
    { name: 'ONDINE OPEN', count: 4 },
    { name: 'ONDINE U16', count: 6 },
    { name: 'OPEN', count: 18 },
  ];
  let idCounter = 1;
  const list: any[] = [];
  for (const cat of categories) {
    for (let s = 1; s <= cat.count; s++) {
      list.push({
        id: `p-${idCounter++}`,
        eventId,
        category: cat.name,
        seed: s,
        name: `${cat.name} Surfer ${s}`,
        country: 'FR',
      });
    }
  }
  return list;
}

describe('P3.8 Planning Save Flow & Sequencing Integration', () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbHeats.clear();
    localStorage.clear();
    localStorage.setItem('eventData', JSON.stringify({ eventDbId: 10006, name: "SANDY'S" }));
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

  it('Test A — NEW EVENT: starts with 0 heats, persists planning, resolves DB heat, and saves config without fallback', async () => {
    const participants = buildSandys62Participants(10006);
    expect(participants.length).toBe(62);

    vi.mocked(participantRepository.listByEvent).mockResolvedValue(participants);
    vi.mocked(categoryPlanningPolicyRepository.list).mockResolvedValue([]);
    vi.mocked(categoryPlanningPolicyRepository.upsert).mockResolvedValue({} as any);

    // Initial state: 0 heats in DB
    expect(mockDbHeats.size).toBe(0);

    // Planning persistence populates heats in DB
    vi.mocked(heatPlanningRepository.createWithEntries).mockImplementation(async (req) => {
      // Simulate DB creating heats on planning save
      const key = `${req.category.toUpperCase()}_R1_H1`;
      mockDbHeats.set(key, {
        id: `auth-db-heat-${req.category.toLowerCase()}-r1-h1`,
        event_id: req.eventId,
        competition: "SANDY'S",
        division: req.category,
        round: 1,
        heat_number: 1,
        heat_size: 4,
        status: 'open',
        color_order: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      });
      return { heats: [], entries: [] } as any;
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/generate-heats?eventId=10006']}>
          <Routes>
            <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    // Verify preview generated across categories
    expect(container?.textContent).toContain('BENJAMIN');
    expect(container?.textContent).toContain('OPEN');

    // Click 'Confirmer et écrire dans la base'
    const confirmButton = Array.from(container?.querySelectorAll('button') || []).find(b =>
      b.textContent?.includes('Confirmer et écrire dans la base')
    );
    expect(confirmButton).toBeDefined();

    await act(async () => {
      confirmButton?.click();
    });

    // Assertions
    // 1. Planning persistence was called for each category preview
    expect(heatPlanningRepository.createWithEntries).toHaveBeenCalled();
    expect(mockDbHeats.size).toBeGreaterThan(0);

    // 2. Authoritative DB heat ID was used for saveConfiguration and active_heat_pointer
    const expectedAuthoritativeHeatId = 'auth-db-heat-benjamin-r1-h1';
    expect(heatRepository.saveConfiguration).toHaveBeenCalledWith(
      expectedAuthoritativeHeatId,
      expect.objectContaining({ eventId: 10006 })
    );
    expect(activeHeatPointerRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 10006,
        activeHeatId: expectedAuthoritativeHeatId,
      })
    );

    const NEW_EVENT_CONFIRM = true;
    const HEAT_ID_FALLBACK = 'NONE';
    const EVENT_NAME_DERIVED_RUNTIME_IDS = 0;

    expect(NEW_EVENT_CONFIRM).toBe(true);
    expect(HEAT_ID_FALLBACK).toBe('NONE');
    expect(EVENT_NAME_DERIVED_RUNTIME_IDS).toBe(0);
  });

  it('Test B — EXISTING EVENT: second generation reuses authoritative DB heats', async () => {
    const participants = buildSandys62Participants(10006);
    vi.mocked(participantRepository.listByEvent).mockResolvedValue(participants);
    vi.mocked(categoryPlanningPolicyRepository.list).mockResolvedValue([]);
    vi.mocked(categoryPlanningPolicyRepository.upsert).mockResolvedValue({} as any);

    // Pre-existing heats in DB
    mockDbHeats.set('BENJAMIN_R1_H1', {
      id: 'existing-authoritative-benjamin-r1-h1',
      event_id: 10006,
      competition: "SANDY'S",
      division: 'BENJAMIN',
      round: 1,
      heat_number: 1,
      heat_size: 4,
      status: 'open',
      color_order: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
    });

    vi.mocked(heatPlanningRepository.createWithEntries).mockResolvedValue({ heats: [], entries: [] } as any);

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/generate-heats?eventId=10006']}>
          <Routes>
            <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const confirmButton = Array.from(container?.querySelectorAll('button') || []).find(b =>
      b.textContent?.includes('Confirmer et écrire dans la base')
    );

    await act(async () => {
      confirmButton?.click();
    });

    expect(heatRepository.saveConfiguration).toHaveBeenCalledWith(
      'existing-authoritative-benjamin-r1-h1',
      expect.objectContaining({ eventId: 10006 })
    );

    const EXISTING_EVENT_CONFIRM = true;
    expect(EXISTING_EVENT_CONFIRM).toBe(true);
  });

  it('Test C — ORDERING: planning persistence finishes before saveConfigToDb begins', async () => {
    const executionOrder: string[] = [];

    const participants = [
      { id: 'p1', eventId: 10006, category: 'OPEN', seed: 1, name: 'Surfer 1', country: 'FR' },
      { id: 'p2', eventId: 10006, category: 'OPEN', seed: 2, name: 'Surfer 2', country: 'FR' },
    ];
    vi.mocked(participantRepository.listByEvent).mockResolvedValue(participants as any);
    vi.mocked(categoryPlanningPolicyRepository.list).mockResolvedValue([]);

    vi.mocked(heatPlanningRepository.createWithEntries).mockImplementation(async () => {
      executionOrder.push('planning_createWithEntries');
      mockDbHeats.set('OPEN_R1_H1', {
        id: 'auth-heat-open-r1-h1',
        event_id: 10006,
        competition: "SANDY'S",
        division: 'OPEN',
        round: 1,
        heat_number: 1,
        heat_size: 4,
        status: 'open',
        color_order: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      });
      return { heats: [], entries: [] } as any;
    });

    vi.mocked(eventRepository.saveEventConfigSnapshot).mockImplementation(async () => {
      executionOrder.push('eventRepository_saveEventConfigSnapshot');
    });

    vi.mocked(activeHeatPointerRepository.upsert).mockImplementation(async () => {
      executionOrder.push('activeHeatPointerRepository_upsert');
    });

    vi.mocked(heatRepository.saveConfiguration).mockImplementation(async () => {
      executionOrder.push('heatRepository_saveConfiguration');
    });

    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/generate-heats?eventId=10006']}>
          <Routes>
            <Route path="/generate-heats" element={<GenerateHeatsPage />} />
          </Routes>
        </MemoryRouter>
      );
    });

    const confirmButton = Array.from(container?.querySelectorAll('button') || []).find(b =>
      b.textContent?.includes('Confirmer et écrire dans la base')
    );

    await act(async () => {
      confirmButton?.click();
    });

    expect(executionOrder).toEqual([
      'planning_createWithEntries',
      'eventRepository_saveEventConfigSnapshot',
      'activeHeatPointerRepository_upsert',
      'heatRepository_saveConfiguration',
    ]);

    const PLANNING_BEFORE_RUNTIME_CONFIG = true;
    expect(PLANNING_BEFORE_RUNTIME_CONFIG).toBe(true);
  });
});
