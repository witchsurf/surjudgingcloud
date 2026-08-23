import { supabase } from '../lib/supabase';
import { categoryPlanningPolicyRepository, type CategoryPlanningPolicy } from './CategoryPlanningPolicyRepository';

export interface ServerPlanningSummary {
  loading: boolean;
  exists: boolean;
  heatCount: number;
  participantCount: number;
  categories: string[];
  policies: Record<string, CategoryPlanningPolicy>;
}

export class PlanningStatusRepository {
  async fetchServerPlanningSummary(eventId: number): Promise<ServerPlanningSummary> {
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      return { loading: false, exists: false, heatCount: 0, participantCount: 0, categories: [], policies: {} };
    }
    if (!supabase) {
      return { loading: false, exists: false, heatCount: 0, participantCount: 0, categories: [], policies: {} };
    }

    try {
      const [heatsRes, partsRes, policiesList] = await Promise.all([
        supabase.from('heats').select('id, division').eq('event_id', eventId),
        supabase.from('participants').select('id, category').eq('event_id', eventId),
        categoryPlanningPolicyRepository.list(eventId).catch(() => []),
      ]);

      const heats = (heatsRes.data ?? []) as { id: string; division: string }[];
      const parts = (partsRes.data ?? []) as { id: number; category: string }[];

      const catsSet = new Set<string>();
      heats.forEach((h) => { if (h.division) catsSet.add(h.division); });
      parts.forEach((p) => { if (p.category) catsSet.add(p.category); });
      policiesList.forEach((pol) => { if (pol.category) catsSet.add(pol.category); });

      const policiesMap: Record<string, CategoryPlanningPolicy> = {};
      policiesList.forEach((pol) => { policiesMap[pol.category] = pol; });

      return {
        loading: false,
        exists: heats.length > 0,
        heatCount: heats.length,
        participantCount: parts.length,
        categories: Array.from(catsSet).sort(),
        policies: policiesMap,
      };
    } catch {
      return { loading: false, exists: false, heatCount: 0, participantCount: 0, categories: [], policies: {} };
    }
  }
}

export const planningStatusRepository = new PlanningStatusRepository();
