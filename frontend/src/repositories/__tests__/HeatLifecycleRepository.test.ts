import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ activateHeatOnPodium: vi.fn(), closeHeatOnPodium: vi.fn() }));
vi.mock('../../api/modules/heats.api', () => api);

import { HeatLifecycleRepository } from '../HeatLifecycleRepository';

const request = {
  eventId: 7,
  podiumId: 'B',
  heatId: 'event_open_r1_h1',
  assignedBy: 'admin-auto-podium-activate',
};
const response = {
  event_id: 7,
  podium_id: 'B',
  heat_id: 'event_open_r1_h1',
  division: 'OPEN',
  round: 1,
  heat_number: 1,
  panel_size: 3,
};

describe('HeatLifecycleRepository activation', () => {
  const repository = new HeatLifecycleRepository();
  beforeEach(() => vi.clearAllMocks());

  it('delegates nominal activation once and maps only the response DTO', async () => {
    api.activateHeatOnPodium.mockResolvedValue(response);
    await expect(repository.activate(request)).resolves.toEqual({
      eventId: 7, podiumId: 'B', heatId: 'event_open_r1_h1', division: 'OPEN',
      round: 1, heatNumber: 1, panelSize: 3,
    });
    expect(api.activateHeatOnPodium).toHaveBeenCalledOnce();
    expect(api.activateHeatOnPodium).toHaveBeenCalledWith(request);
  });

  it.each([
    ['wrong heat id', new Error('Heat missing does not belong to event 7')],
    ['wrong event/podium', Object.assign(new Error('permission denied'), { code: '42501' })],
  ])('propagates %s errors and RLS metadata unchanged', async (_label, error) => {
    api.activateHeatOnPodium.mockRejectedValue(error);
    await expect(repository.activate(request)).rejects.toBe(error);
  });

  it('does not deduplicate a double activation/retry in the client facade', async () => {
    api.activateHeatOnPodium.mockResolvedValue(response);
    await repository.activate(request);
    await repository.activate(request);
    expect(api.activateHeatOnPodium).toHaveBeenCalledTimes(2);
    expect(api.activateHeatOnPodium.mock.calls[0][0]).toEqual(api.activateHeatOnPodium.mock.calls[1][0]);
  });

  it('delegates an already-active heat to the RPC without a client-side status rule', async () => {
    api.activateHeatOnPodium.mockResolvedValue(response);
    await expect(repository.activate(request)).resolves.toMatchObject({ heatId: request.heatId });
    expect(api.activateHeatOnPodium).toHaveBeenCalledWith(request);
  });

  it('contains no scoring dependency or operation', () => {
    const source = readFileSync(resolve(__dirname, '../HeatLifecycleRepository.ts'), 'utf8');
    expect(source).not.toMatch(/scor(?:e|ing)|ScoreRepository|scores/i);
  });

  it('delegates close and preserves intrinsic qualification counts', async () => {
    const closeRequest = { eventId: 7, podiumId: 'B', heatId: 'event_open_r1_h1', closedBy: 'admin-close-heat' };
    api.closeHeatOnPodium.mockResolvedValue({
      event_id: 7, podium_id: 'B', closed_heat_id: 'event_open_r1_h1', forced: false,
      readiness: { can_close: true }, qualifier_slots_updated: 2, division_slots_rebuilt: 3, next: null,
    });
    await expect(repository.close(closeRequest)).resolves.toEqual({
      eventId: 7, podiumId: 'B', closedHeatId: 'event_open_r1_h1', forced: false,
      readiness: { can_close: true }, qualifierSlotsUpdated: 2, divisionSlotsRebuilt: 3, next: null,
    });
    expect(api.closeHeatOnPodium).toHaveBeenCalledWith(closeRequest);
  });

  it.each([
    ['already closed', Object.assign(new Error('HEAT_CLOSE_BLOCKED'), { code: '23514' })],
    ['invalid heat/event/podium', Object.assign(new Error('Heat is not active on podium B'), { code: '23514' })],
    ['readiness blocker', Object.assign(new Error('HEAT_CLOSE_BLOCKED:{"can_close":false}'), { code: '23514' })],
  ])('propagates close error: %s', async (_label, error) => {
    api.closeHeatOnPodium.mockRejectedValue(error);
    await expect(repository.close({ eventId: 7, podiumId: 'B', heatId: 'h1' })).rejects.toBe(error);
  });

  it('does not deduplicate double close/retry', async () => {
    const closeRequest = { eventId: 7, podiumId: 'B', heatId: 'h1' };
    api.closeHeatOnPodium.mockResolvedValue({
      event_id: 7, podium_id: 'B', closed_heat_id: 'h1', qualifier_slots_updated: 0, division_slots_rebuilt: 0,
    });
    await repository.close(closeRequest);
    await repository.close(closeRequest);
    expect(api.closeHeatOnPodium).toHaveBeenCalledTimes(2);
    expect(api.closeHeatOnPodium.mock.calls[0][0]).toEqual(api.closeHeatOnPodium.mock.calls[1][0]);
  });
});
