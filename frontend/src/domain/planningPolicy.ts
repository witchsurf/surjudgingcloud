export type CategoryPlanningFormat = 'elimination' | 'repechage' | 'man_on_man';

export interface CategoryPlanningPolicy {
  event_id: number;
  category: string;
  base_format: CategoryPlanningFormat;
  transition_round: number | null;
  transition_format: CategoryPlanningFormat | null;
  version: number;
  created_at?: string;
  updated_at?: string;
}
