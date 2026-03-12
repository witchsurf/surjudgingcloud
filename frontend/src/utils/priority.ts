import type { PriorityState } from '../types';

const normalizeSurfer = (surfer: string) => (surfer || '').trim().toUpperCase();

const unique = (surfers: string[]) => {
  const seen = new Set<string>();
  return surfers.filter((surfer) => {
    const normalized = normalizeSurfer(surfer);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};

export const buildEqualPriorityState = (): PriorityState => ({
  mode: 'equal',
  order: [],
  inFlight: [],
  updatedAt: new Date().toISOString(),
});

export const normalizePriorityState = (
  state: PriorityState | undefined,
  surfers: string[]
): PriorityState => {
  const normalizedSurfers = unique(surfers.map(normalizeSurfer));
  const surferSet = new Set(normalizedSurfers);
  const normalizedOrder = unique((state?.order || []).map(normalizeSurfer))
    .filter((surfer) => surferSet.has(surfer));
  const orderSet = new Set(normalizedOrder);
  const normalizedInFlight = unique((state?.inFlight || []).map(normalizeSurfer))
    .filter((surfer) => surferSet.has(surfer) && !orderSet.has(surfer));

  if (state?.mode === 'ordered' || state?.mode === 'opening') {
    return {
      mode: state.mode,
      order: normalizedOrder,
      inFlight: normalizedInFlight,
      updatedAt: state.updatedAt,
    };
  }

  return {
    mode: 'equal',
    order: [],
    inFlight: [],
    updatedAt: state?.updatedAt,
  };
};

export const setPriorityOrder = (order: string[]): PriorityState => ({
  mode: 'ordered',
  order: unique(order.map(normalizeSurfer)),
  inFlight: [],
  updatedAt: new Date().toISOString(),
});

export const removePrioritySurfer = (state: PriorityState, surfer: string): PriorityState => {
  const normalized = normalizeSurfer(surfer);
  if (state.mode === 'equal') {
    return {
      mode: 'opening',
      order: [normalized],
      inFlight: [normalized],
      updatedAt: new Date().toISOString(),
    };
  }

  if (state.mode === 'opening') {
    const alreadyKnown = state.order.includes(normalized);
    const nextOrder = alreadyKnown ? state.order : [...state.order, normalized];
    const nextInFlight = state.inFlight.includes(normalized)
      ? state.inFlight
      : [...state.inFlight, normalized];

    return {
      ...state,
      order: nextOrder,
      inFlight: nextInFlight,
      updatedAt: new Date().toISOString(),
    };
  }

  if (state.mode !== 'ordered' || !state.order.includes(normalized)) return state;

  return {
    ...state,
    order: state.order.filter((item) => item !== normalized),
    inFlight: state.inFlight.includes(normalized)
      ? state.inFlight
      : [...state.inFlight, normalized],
    updatedAt: new Date().toISOString(),
  };
};

export const returnPrioritySurfer = (state: PriorityState, surfer: string): PriorityState => {
  const normalized = normalizeSurfer(surfer);
  if (state.mode === 'opening') {
    if (!state.inFlight.includes(normalized)) return state;
    return {
      ...state,
      inFlight: state.inFlight.filter((item) => item !== normalized),
      updatedAt: new Date().toISOString(),
    };
  }

  if (state.mode !== 'ordered' || !state.inFlight.includes(normalized)) return state;

  return {
    ...state,
    order: [...state.order, normalized],
    inFlight: state.inFlight.filter((item) => item !== normalized),
    updatedAt: new Date().toISOString(),
  };
};

export const getPriorityLabels = (
  state: PriorityState,
  surfers: string[]
): Record<string, string> => {
  const normalizedSurfers = unique(surfers.map(normalizeSurfer));

  if (state.mode === 'equal') {
    return normalizedSurfers.reduce<Record<string, string>>((acc, surfer) => {
      acc[surfer] = '=';
      return acc;
    }, {});
  }

  if (state.mode === 'opening') {
    const startRank = Math.max(normalizedSurfers.length - state.order.length + 1, 1);
    const labels = normalizedSurfers.reduce<Record<string, string>>((acc, surfer) => {
      if (!state.order.includes(surfer)) {
        acc[surfer] = '=';
      }
      return acc;
    }, {});

    state.order.forEach((surfer, index) => {
      labels[surfer] = String(startRank + index);
    });

    return labels;
  }

  return state.order.reduce<Record<string, string>>((acc, surfer, index) => {
    acc[surfer] = index === 0 ? 'P' : String(index + 1);
    return acc;
  }, {});
};

export const promoteOpeningToOrdered = (
  state: PriorityState,
  surfers: string[]
): PriorityState => {
  const normalizedSurfers = unique(surfers.map(normalizeSurfer));
  if (state.mode !== 'opening' || state.order.length < normalizedSurfers.length) {
    return state;
  }

  return {
    mode: 'ordered',
    order: [...state.order],
    inFlight: [...state.inFlight],
    updatedAt: new Date().toISOString(),
  };
};
