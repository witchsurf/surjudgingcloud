/** Explicit repair tools; never part of nominal scoring or lifecycle close. */
export interface QualificationRecoveryRepositoryContract {
  propagateSourceHeat(heatId: string): Promise<number>;
  rebuildDivision(eventId: number, division: string): Promise<number>;
}
