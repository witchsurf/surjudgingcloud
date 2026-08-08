import type {
  EventRepositoryContract,
  ActiveHeatPointerRepositoryContract,
  HeatRepositoryContract,
  HeatLifecycleRepositoryContract,
  HeatPlanningRepositoryContract,
  JudgeRepositoryContract,
  PanelRepositoryContract,
  PlanningSafetyRepositoryContract,
  QualificationRecoveryRepositoryContract,
  ParticipantRepositoryContract,
  ScoreRepositoryContract,
  ScoringReadRepositoryContract,
} from './contracts';
import { activeHeatPointerRepository } from './ActiveHeatPointerRepository';
import { eventRepository } from './EventRepository';
import { heatRepository } from './HeatRepository';
import { heatLifecycleRepository } from './HeatLifecycleRepository';
import { heatPlanningRepository } from './HeatPlanningRepository';
import { judgeRepository } from './JudgeRepository';
import { panelRepository } from './PanelRepository';
import { participantRepository } from './ParticipantRepository';
import { planningSafetyRepository } from './PlanningSafetyRepository';
import { qualificationRecoveryRepository } from './QualificationRecoveryRepository';
import { scoreRepository } from './ScoreRepository';
import { scoringReadRepository } from './ScoringReadRepository';

/**
 * Transport-neutral repository surface and the single active Supabase-backed
 * registry. Future implementations can replace this registry without leaking
 * transport types to consumers.
 */
export interface RepositoryRegistry {
  readonly activeHeatPointer: ActiveHeatPointerRepositoryContract;
  readonly events: EventRepositoryContract;
  readonly heats: HeatRepositoryContract;
  readonly heatLifecycle: HeatLifecycleRepositoryContract;
  readonly heatPlanning: HeatPlanningRepositoryContract;
  readonly judges: JudgeRepositoryContract;
  readonly panels: PanelRepositoryContract;
  readonly planningSafety: PlanningSafetyRepositoryContract;
  readonly qualificationRecovery: QualificationRecoveryRepositoryContract;
  readonly participants: ParticipantRepositoryContract;
  readonly scores: ScoreRepositoryContract;
  readonly scoringReads: ScoringReadRepositoryContract;
}

export const repositoryRegistry: RepositoryRegistry = Object.freeze({
  activeHeatPointer: activeHeatPointerRepository,
  events: eventRepository,
  heats: heatRepository,
  heatLifecycle: heatLifecycleRepository,
  heatPlanning: heatPlanningRepository,
  judges: judgeRepository,
  panels: panelRepository,
  planningSafety: planningSafetyRepository,
  qualificationRecovery: qualificationRecoveryRepository,
  participants: participantRepository,
  scores: scoreRepository,
  scoringReads: scoringReadRepository,
});
