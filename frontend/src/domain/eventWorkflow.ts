import type { DeploymentMode } from './deploymentMode';

export type PaymentStatus = 'paid' | 'test_activated' | 'unpaid';

export interface EventWorkflowState {
  eventId: number | null;
  persisted: boolean;
  paymentStatus: PaymentStatus;
}

export const parseCanonicalEventId = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

export const isPaymentValidated = (event: {
  paid?: boolean | null;
  status?: string | null;
}): boolean => event.paid === true || event.status === 'paid';

export const isTestActivationValidated = (event: {
  test_activated_at?: string | null;
  test_activated_by?: string | null;
}): boolean => Boolean(event.test_activated_at && event.test_activated_by);

export const resolveEventWorkflowState = (event: {
  id?: unknown;
  paid?: boolean | null;
  status?: string | null;
  test_activated_at?: string | null;
  test_activated_by?: string | null;
} | null | undefined): EventWorkflowState => {
  const eventId = parseCanonicalEventId(event?.id);
  const paymentStatus: PaymentStatus = eventId === null
    ? 'unpaid'
    : isPaymentValidated(event ?? {})
      ? 'paid'
      : isTestActivationValidated(event ?? {})
        ? 'test_activated'
        : 'unpaid';
  return {
    eventId,
    persisted: eventId !== null,
    paymentStatus,
  };
};

export const eventCanRunCompetition = (
  state: EventWorkflowState,
  mode: DeploymentMode,
): boolean => state.persisted
  && state.eventId !== null
  && (mode === 'field' || state.paymentStatus === 'paid' || state.paymentStatus === 'test_activated');

export const canProceedToParticipants = (
  state: EventWorkflowState,
  mode: DeploymentMode,
): boolean => eventCanRunCompetition(state, mode);

export const canPersistHeats = canProceedToParticipants;

export const assertPlanningAllowed = (state: EventWorkflowState, mode: DeploymentMode): number => {
  if (!state.persisted || state.eventId === null) {
    throw new Error("L’événement doit être sauvegardé en base avec un ID numérique avant d’écrire les heats.");
  }
  if (mode === 'cloud' && !eventCanRunCompetition(state, mode)) {
    throw new Error("Le paiement Cloud doit être validé avant d’écrire les heats.");
  }
  return state.eventId;
};

export const ownedEventFilter = (userId: string): string =>
  `user_id.eq.${userId},owner_id.eq.${userId}`;

export const planningSuccessRoute = '/admin';

export const competitionAdminRoute = (eventId: unknown): string => {
  const canonicalId = parseCanonicalEventId(eventId);
  if (canonicalId === null) {
    throw new Error("L’identifiant canonique de l’événement est absent ou invalide.");
  }
  return `/admin?eventId=${canonicalId}`;
};
