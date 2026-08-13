export type ReconcileHeat = {
  id: string;
  division: string;
  round: number;
  heat_number: number;
  status?: string | null;
};

export type ReconcileInput = {
  division: string;
  currentRound: number;
  currentHeatId: number;
  visibleRoundOptions: number[];
  heats: ReconcileHeat[];
  authoritativeStatuses?: Map<string, string>;
  activeHeatIds?: Set<string>;
  pending?: { division: string; round: number; heatId: number } | null;
  showClosedHeats?: boolean;
};

/** Pure W5 decision. Pending division selection always wins over stale derived inputs. */
export function reconcileRoundHeat(input: ReconcileInput): { round: number; heatId: number } | null {
  const division = input.division.trim().toLowerCase();
  if (input.pending && input.pending.division.trim().toLowerCase() === division) {
    const pendingRow = input.heats.find((row) =>
      row.division.trim().toLowerCase() === division &&
      row.round === input.pending!.round &&
      row.heat_number === input.pending!.heatId
    );
    if (pendingRow) return { round: input.pending.round, heatId: input.pending.heatId };
  }

  if (!input.visibleRoundOptions.length) return null;
  const nextRound = input.visibleRoundOptions.includes(input.currentRound)
    ? input.currentRound
    : input.visibleRoundOptions[0];
  const active = input.activeHeatIds || new Set<string>();
  const statuses = input.authoritativeStatuses || new Map<string, string>();
  const eligible = input.heats
    .filter((row) => row.division.trim().toLowerCase() === division && row.round === nextRound)
    .filter((row) => (input.showClosedHeats || (statuses.get(row.id) || row.status || '').toLowerCase() !== 'closed'))
    .filter((row) => !active.has(row.id))
    .map((row) => row.heat_number)
    .sort((a, b) => a - b);
  const firstHeat = eligible[0] ?? input.currentHeatId;
  const nextHeatId = eligible.includes(input.currentHeatId) && nextRound === input.currentRound
    ? input.currentHeatId
    : firstHeat;
  if (nextRound === input.currentRound && nextHeatId === input.currentHeatId) return null;
  return { round: nextRound, heatId: nextHeatId };
}
