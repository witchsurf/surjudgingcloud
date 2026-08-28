export type PriorityDisplayColor = 'ROUGE' | 'BLANC' | 'JAUNE' | 'BLEU' | 'VERT' | 'NOIR';

export interface ActivePrioritySnapshot {
  heat_id?: string | null;
  status?: string | null;
  priority_state?: unknown;
  surfers?: unknown;
  timer_remaining_seconds?: number | null;
}

export type PriorityDisplayReason =
  | 'active_priority'
  | 'signal_lost'
  | 'no_active_heat'
  | 'heat_inactive'
  | 'priority_not_established'
  | 'invalid_priority';

export interface PriorityDisplaySignal {
  colors: PriorityDisplayColor[];
  cssColors: string[];
  reason: PriorityDisplayReason;
}

const COLOR_ALIASES: Record<string, PriorityDisplayColor> = {
  RED: 'ROUGE', ROUGE: 'ROUGE',
  WHITE: 'BLANC', BLANC: 'BLANC',
  YELLOW: 'JAUNE', JAUNE: 'JAUNE',
  BLUE: 'BLEU', BLEU: 'BLEU',
  GREEN: 'VERT', VERT: 'VERT',
  BLACK: 'NOIR', NOIR: 'NOIR',
};

export const PRIORITY_DISPLAY_RGB: Record<PriorityDisplayColor, string> = {
  ROUGE: '#ff0000',
  BLANC: '#ffffff',
  JAUNE: '#ffff00',
  BLEU: '#0000ff',
  VERT: '#00ff00',
  NOIR: '#000000',
};

const BLACK = '#000000';

const normalizeColor = (value: unknown): PriorityDisplayColor | null => {
  if (typeof value !== 'string') return null;
  return COLOR_ALIASES[value.trim().toUpperCase()] ?? null;
};

const normalizeColorList = (value: unknown): PriorityDisplayColor[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PriorityDisplayColor>();
  return value.reduce<PriorityDisplayColor[]>((colors, item) => {
    const color = normalizeColor(item);
    if (color && !seen.has(color)) {
      seen.add(color);
      colors.push(color);
    }
    return colors;
  }, []);
};

export const resolvePriorityDisplaySignal = (
  snapshot: ActivePrioritySnapshot | null | undefined,
  isFresh: boolean,
): PriorityDisplaySignal => {
  if (!isFresh) return { colors: [], cssColors: [], reason: 'signal_lost' };
  if (!snapshot?.heat_id) return { colors: [], cssColors: [], reason: 'no_active_heat' };

  const status = String(snapshot.status || '').trim().toLowerCase();
  if (status !== 'running' && status !== 'paused') {
    return { colors: [], cssColors: [], reason: 'heat_inactive' };
  }

  const state = snapshot.priority_state;
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { colors: [], cssColors: [], reason: 'priority_not_established' };
  }

  const priority = state as { mode?: unknown; order?: unknown; inFlight?: unknown };
  if (priority.mode !== 'ordered') {
    return { colors: [], cssColors: [], reason: 'priority_not_established' };
  }

  const order = normalizeColorList(priority.order);
  const inFlight = normalizeColorList(priority.inFlight);
  const surfers = normalizeColorList(snapshot.surfers);
  const completeLineup = [...order, ...inFlight];
  const invalidOrder = order.some((color) => inFlight.includes(color))
    || (surfers.length > 0 && (
      completeLineup.length !== surfers.length
      || completeLineup.some((color) => !surfers.includes(color))
    ));
  if (invalidOrder) {
    return { colors: [], cssColors: [], reason: 'invalid_priority' };
  }

  return {
    colors: order,
    cssColors: order.map((color) => PRIORITY_DISPLAY_RGB[color] ?? BLACK),
    reason: 'active_priority',
  };
};
