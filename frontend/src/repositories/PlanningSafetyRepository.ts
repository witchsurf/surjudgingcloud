import { fetchPlanningSafetyInventory, persistSafePlanningRpc } from '../api/modules/planningSafety.api';
import type {
  PlanningSafetyPreflightRequest,
  PlanningSafetyPreflightResult,
  PlanningSafetyRepositoryContract,
  SafePlanningPersistenceRequest,
} from './contracts';

export class PlanningSafetyRepository implements PlanningSafetyRepositoryContract {
  async preflight(request: PlanningSafetyPreflightRequest): Promise<PlanningSafetyPreflightResult> {
    const rows = await fetchPlanningSafetyInventory(request);
    const targetedHeats = rows.map((row) => ({
      heatId: row.heat_id,
      status: row.status,
      isActive: row.is_active,
      scoreCount: row.score_count,
      overrideCount: row.override_count,
      interferenceCount: row.interference_count,
      judgeAssignmentCount: row.judge_assignment_count,
      timerCount: row.timer_count,
      historyCount: row.history_count,
      activePointerCount: row.active_pointer_count,
      blockerReasons: row.blocker_reasons,
    }));
    return {
      state: targetedHeats.some((heat) => heat.blockerReasons.length > 0) ? 'BLOCKED' : 'SAFE',
      targetedHeats,
    };
  }

  persistSafePlanning(request: SafePlanningPersistenceRequest): Promise<void> {
    return persistSafePlanningRpc(request);
  }
}

export const planningSafetyRepository = new PlanningSafetyRepository();
