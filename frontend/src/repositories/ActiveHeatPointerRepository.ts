import type {
  ActiveHeatPointerRecord,
  ActiveHeatPointerRepositoryContract,
  ReadActiveHeatPointerRequest,
  WriteActiveHeatPointerRequest,
} from './contracts';
import { fetchActiveHeatPointer, upsertActiveHeatPointer } from '../api/modules/heats.api';

export class ActiveHeatPointerRepository implements ActiveHeatPointerRepositoryContract {
  async get(request: ReadActiveHeatPointerRequest = {}): Promise<ActiveHeatPointerRecord | null> {
    const row = await fetchActiveHeatPointer(request.eventId, request.eventName, request.podiumId);
    return row ? {
      eventId: row.event_id ?? null,
      eventName: row.event_name,
      podiumId: row.podium_id ?? null,
      activeHeatId: row.active_heat_id,
      updatedAt: row.updated_at,
    } : null;
  }

  upsert(request: WriteActiveHeatPointerRequest): Promise<void> {
    return upsertActiveHeatPointer(request);
  }
}

export const activeHeatPointerRepository = new ActiveHeatPointerRepository();
