import { describe, expect, it } from 'vitest';
import {
  assertPlanningAllowed,
  canPersistHeats,
  canProceedToParticipants,
  competitionAdminRoute,
  ownedEventFilter,
  parseCanonicalEventId,
  planningSuccessRoute,
  resolveEventWorkflowState,
} from '../eventWorkflow';
import {
  allowsCloudAuth,
  allowsCloudSync,
  allowsPayment,
  parseDeploymentMode,
  requireDeploymentMode,
} from '../deploymentMode';
import { canEnableDevMode } from '../../lib/offlineAuth';

describe('workflow événement Cloud', () => {
  it('accepte le bigint canonique retourné par la DB Cloud', () => {
    expect(resolveEventWorkflowState({ id: 42 }).eventId).toBe(42);
  });

  it('bloque les participants avant validation du paiement', () => {
    expect(canProceedToParticipants(resolveEventWorkflowState({ id: 42, paid: false }), 'cloud')).toBe(false);
  });

  it('autorise les participants après validation du paiement', () => {
    expect(canProceedToParticipants(resolveEventWorkflowState({ id: 42, paid: true }), 'cloud')).toBe(true);
  });

  it('autorise une activation test auditée sans la confondre avec un paiement', () => {
    const state = resolveEventWorkflowState({
      id: 42,
      paid: false,
      status: 'pending',
      test_activated_at: '2026-08-09T12:00:00Z',
      test_activated_by: 'owner-1',
    });
    expect(state.paymentStatus).toBe('test_activated');
    expect(canProceedToParticipants(state, 'cloud')).toBe(true);
    expect(canPersistHeats(state, 'cloud')).toBe(true);
  });

  it('refuse une activation test partielle', () => {
    const state = resolveEventWorkflowState({
      id: 42,
      paid: false,
      test_activated_at: '2026-08-09T12:00:00Z',
      test_activated_by: null,
    });
    expect(state.paymentStatus).toBe('unpaid');
    expect(canPersistHeats(state, 'cloud')).toBe(false);
  });

  it('autorise la persistance safe v2 des heats payés', () => {
    const state = resolveEventWorkflowState({ id: 42, status: 'paid' });
    expect(canPersistHeats(state, 'cloud')).toBe(true);
    expect(assertPlanningAllowed(state, 'cloud')).toBe(42);
  });

  it('termine sur la route officielle /admin', () => {
    expect(planningSuccessRoute).toBe('/admin');
  });

  it('transmet le bigint événement canonique à la route Admin', () => {
    expect(competitionAdminRoute(42)).toBe('/admin?eventId=42');
    expect(() => competitionAdminRoute('legacy-slug')).toThrow(/canonique/);
  });

  it('construit le filtre owner_id/user_id de rechargement', () => {
    expect(ownedEventFilter('user-1')).toBe('user_id.eq.user-1,owner_id.eq.user-1');
  });
});

describe('workflow événement Field', () => {
  it('est un mode explicite et versionnable', () => {
    expect(parseDeploymentMode('field')).toBe('field');
  });

  it('accepte le bigint canonique retourné par Supabase local', () => {
    expect(resolveEventWorkflowState({ id: '73' }).eventId).toBe(73);
  });

  it('n’exige aucune page de paiement', () => {
    expect(allowsPayment('field')).toBe(false);
  });

  it('autorise immédiatement les participants après persistance locale', () => {
    expect(canProceedToParticipants(resolveEventWorkflowState({ id: 73, paid: false }), 'field')).toBe(true);
  });

  it('supporte Competition X sans règle spéciale liée au nom', () => {
    const event = resolveEventWorkflowState({ id: 73, paid: false });
    expect(canProceedToParticipants(event, 'field')).toBe(true);
  });

  it('autorise la persistance safe v2 locale', () => {
    expect(assertPlanningAllowed(resolveEventWorkflowState({ id: 73 }), 'field')).toBe(73);
  });

  it('termine sur /admin', () => {
    expect(planningSuccessRoute).toBe('/admin');
  });

  it('reste persistant après reconstruction depuis une ligne locale rechargée', () => {
    expect(canPersistHeats(resolveEventWorkflowState({ id: 73 }), 'field')).toBe(true);
  });
});

describe('hybrides interdits', () => {
  it('VITE_DEV_MODE ne contourne jamais l’auth Cloud', () => {
    expect(canEnableDevMode(true, true, true, 'cloud')).toBe(false);
    expect(allowsCloudAuth('cloud')).toBe(true);
  });

  it('Field ne permet ni paiement ni synchronisation Cloud', () => {
    expect(allowsPayment('field')).toBe(false);
    expect(allowsCloudSync('field')).toBe(false);
  });

  it('refuse tous les pseudo-ID textuels', () => {
    expect(parseCanonicalEventId('competition-x-1723300000')).toBeNull();
    expect(parseCanonicalEventId('42x')).toBeNull();
  });

  it('interdit toute écriture de heats pour un événement non persisté', () => {
    const state = resolveEventWorkflowState({ id: 'competition-x-1723300000', paid: true });
    expect(canPersistHeats(state, 'cloud')).toBe(false);
    expect(canPersistHeats(state, 'field')).toBe(false);
  });

  it('refuse une configuration de mode implicite ou invalide', () => {
    expect(() => requireDeploymentMode(undefined)).toThrow(/VITE_DEPLOYMENT_MODE/);
    expect(() => requireDeploymentMode('local')).toThrow(/VITE_DEPLOYMENT_MODE/);
  });
});
