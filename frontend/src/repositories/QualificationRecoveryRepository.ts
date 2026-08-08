import type { QualificationRecoveryRepositoryContract } from './contracts';
import {
  propagateQualifiersForSourceHeat,
  rebuildDivisionQualifiersFromScores,
} from '../api/modules/heats.api';

/** Manual recovery facade. Nominal close remains owned by HeatLifecycleRepository. */
export class QualificationRecoveryRepository implements QualificationRecoveryRepositoryContract {
  propagateSourceHeat(heatId: string): Promise<number> {
    return propagateQualifiersForSourceHeat(heatId);
  }

  rebuildDivision(eventId: number, division: string): Promise<number> {
    return rebuildDivisionQualifiersFromScores(eventId, division);
  }
}

export const qualificationRecoveryRepository = new QualificationRecoveryRepository();
