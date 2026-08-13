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
  const active = input.activeHeatIds || new Set<string>();
  const statuses = input.authoritativeStatuses || new Map<string, string>();
  const eligible = input.heats
    .filter((row) => row.division.trim().toLowerCase() === division)
    .filter((row) => (input.showClosedHeats || (statuses.get(row.id) || row.status || '').toLowerCase() !== 'closed'))
    .filter((row) => !active.has(row.id))
    .sort((a, b) => a.round - b.round || a.heat_number - b.heat_number);
  const current = eligible.find((row) => row.round === input.currentRound && row.heat_number === input.currentHeatId);
  if (current) return null;
  const first = eligible[0];
  if (!first) return null;
  return { round: first.round, heatId: first.heat_number };
}
