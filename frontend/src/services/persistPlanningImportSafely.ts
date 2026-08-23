import type { CanonicalPlanningInput } from '../domain/planningImport/contracts';
import { heatPlanningRepository } from '../repositories/HeatPlanningRepository';
import { eventRepository } from '../repositories/EventRepository';
import type { ParticipantRecord } from '../repositories/contracts';
import type { ComputeResult, FormatType } from '../utils/bracket';

export interface PersistPlanningImportSafelyRequest {
  input: CanonicalPlanningInput;
  preview: ComputeResult;
  eventId: number;
  eventName?: string;
  category: string;
  format: FormatType;
  overwrite: boolean;
}

export async function persistPlanningImportSafely(request: PersistPlanningImportSafelyRequest): Promise<void> {
  if (!Number.isSafeInteger(request.eventId) || request.eventId <= 0) throw new Error('Événement invalide');
  const participants = request.input.participants.filter((participant) => participant.category === request.category);
  if (participants.length === 0) throw new Error('Catégorie absente de l’import canonique');
  if (request.preview.rounds.length === 0) throw new Error('Preview bracket absente');
  const eventName = request.eventName?.trim() || (await eventRepository.fetchEvent(request.eventId))?.name?.trim();
  if (!eventName) throw new Error('Événement introuvable : impossible de créer le planning');

  const participantsBySeed = new Map<number, ParticipantRecord>(participants.map((participant) => [
    participant.seed,
    {
      id: 0,
      eventId: request.eventId,
      category: participant.category,
      seed: participant.seed,
      name: participant.name,
      country: participant.country,
      license: participant.license,
    },
  ]));

  await heatPlanningRepository.createWithEntries({
    eventId: request.eventId,
    eventName,
    category: request.category,
    rounds: request.preview.rounds,
    participantsBySeed,
    options: {
      overwrite: request.overwrite,
      repechage: request.preview.repechage,
      defaultJudges: ['J1', 'J2', 'J3'],
      tournamentType: request.format === 'single-elim' ? 'elimination' : 'repechage',
      progressionEdges: (request.preview.progressionEdges ?? []).map((edge) => ({
        event_id: request.eventId,
        category: request.category,
        target_heat_id: `${eventName}_${request.category}_R${edge.targetRound}_H${edge.targetHeat}`.toLowerCase().replace(/\s+/g, '_'),
        target_position: edge.targetPosition,
        source_round: edge.sourceRound,
        source_heat: edge.sourceHeat === 0 ? 'BYE' : `${eventName}_${request.category}_R${edge.sourceRound}_H${edge.sourceHeat}`.toLowerCase().replace(/\s+/g, '_'),
        source_position: edge.sourcePosition,
        progression_type: edge.type,
      })),
    },
  });
}
