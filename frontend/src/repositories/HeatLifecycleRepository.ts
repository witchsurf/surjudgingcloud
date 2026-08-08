import type {
  ActivateHeatRequest,
  ActivateHeatResult,
  CloseHeatRequest,
  CloseHeatResult,
  HeatLifecycleRepositoryContract,
} from './contracts';
import { activateHeatOnPodium, closeHeatOnPodium } from '../api/modules/heats.api';

/**
 * Atomic heat transitions belong to orchestration, not heat CRUD.
 * The existing Supabase adapter remains the sole owner of RPC normalization.
 */
export class HeatLifecycleRepository implements HeatLifecycleRepositoryContract {
  async activate(request: ActivateHeatRequest): Promise<ActivateHeatResult> {
    const result = await activateHeatOnPodium(request);
    return {
      eventId: result.event_id,
      podiumId: result.podium_id,
      heatId: result.heat_id || request.heatId,
      division: result.division,
      round: result.round,
      heatNumber: result.heat_number,
      panelSize: result.panel_size,
    };
  }

  async close(request: CloseHeatRequest): Promise<CloseHeatResult> {
    const result = await closeHeatOnPodium(request);
    return {
      eventId: result.event_id,
      podiumId: result.podium_id,
      closedHeatId: result.closed_heat_id || request.heatId,
      forced: result.forced,
      readiness: result.readiness,
      qualifierSlotsUpdated: Number(result.qualifier_slots_updated || 0),
      divisionSlotsRebuilt: Number(result.division_slots_rebuilt || 0),
      next: result.next,
    };
  }
}

export const heatLifecycleRepository = new HeatLifecycleRepository();
