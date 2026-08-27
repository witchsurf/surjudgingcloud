import { supabase } from '../lib/supabase';
import type { CategoryPlanningFormat, CategoryPlanningPolicy } from '../domain/planningPolicy';

export type { CategoryPlanningFormat, CategoryPlanningPolicy } from '../domain/planningPolicy';

const TABLE = 'event_category_planning_config' as never;

function validate(policy: Pick<CategoryPlanningPolicy, 'category' | 'base_format' | 'transition_round' | 'transition_format'>) {
  if (!policy.category.trim()) throw new Error('category is required');
  if (!['elimination', 'repechage', 'man_on_man'].includes(policy.base_format)) throw new Error('unsupported base format');
  if (policy.transition_round != null && policy.transition_round < 2) throw new Error('transition round must be >= 2');
  if (policy.transition_round == null && policy.transition_format != null) throw new Error('transition format requires transition round');
  if (policy.transition_round != null && policy.transition_format == null) throw new Error('transition format is required');
  if (policy.transition_format === policy.base_format && policy.transition_format != null) throw new Error('transition format must differ from base format');
}

export class CategoryPlanningPolicyRepository {
  async list(eventId: number): Promise<CategoryPlanningPolicy[]> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('event_id', eventId).order('category');
    if (error) throw error;
    return (data ?? []) as CategoryPlanningPolicy[];
  }

  async get(eventId: number, category: string): Promise<CategoryPlanningPolicy | null> {
    const { data, error } = await supabase.from(TABLE).select('*').eq('event_id', eventId).eq('category', category).maybeSingle();
    if (error) throw error;
    return (data as CategoryPlanningPolicy | null) ?? null;
  }

  async upsert(policy: CategoryPlanningPolicy): Promise<CategoryPlanningPolicy> {
    validate(policy);
    const { data, error } = await supabase.from(TABLE).upsert(policy, { onConflict: 'event_id,category' }).select('*').single();
    if (error) throw error;
    return data as CategoryPlanningPolicy;
  }

  async reset(eventId: number, category: string): Promise<void> {
    const { error } = await supabase.from(TABLE).delete().eq('event_id', eventId).eq('category', category);
    if (error) throw error;
  }
}

export const categoryPlanningPolicyRepository = new CategoryPlanningPolicyRepository();
