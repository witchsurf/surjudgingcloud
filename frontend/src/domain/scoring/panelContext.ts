import type { SupportedPanelSize } from './contracts';

export type PanelSource = 'heat_config' | 'assignments' | 'runtime_snapshot' | 'unknown';
export type PanelContextIssue = 'panel_unknown' | 'panel_conflict' | 'panel_invalid' | 'network_error';

export interface PanelContext {
  judgeCount: SupportedPanelSize | null;
  source: PanelSource;
  issue?: PanelContextIssue;
  message?: string;
}

export interface PanelAssignmentInput {
  station?: string | null;
  judgeId?: string | null;
}

export interface ResolvePanelContextInput {
  heatConfigJudges?: unknown;
  assignments?: readonly PanelAssignmentInput[];
  runtimeSnapshotJudges?: readonly string[] | null;
  /** Diagnostic only. It is intentionally never used to resolve the panel. */
  observedScoreCount?: number;
}

type Candidate = {
  source: Exclude<PanelSource, 'unknown'>;
  present: boolean;
  count: SupportedPanelSize | null;
  invalidReason?: string;
};

const supportedCount = (count: number): SupportedPanelSize | null => count === 3 || count === 5 ? count : null;

const judgesCandidate = (
  source: 'heat_config' | 'runtime_snapshot',
  value: unknown,
): Candidate => {
  if (value === undefined || value === null) return { source, present: false, count: null };
  if (!Array.isArray(value)) return { source, present: true, count: null, invalidReason: `${source}: liste de juges invalide` };
  if (value.length === 0) return { source, present: false, count: null };
  const normalized = value.map((judge) => {
    if (judge && typeof judge === 'object') {
      const candidateObj = judge as Record<string, unknown>;
      const idVal = candidateObj.id ?? candidateObj.station ?? candidateObj.name;
      return String(idVal || '').trim().toUpperCase();
    }
    return String(judge || '').trim().toUpperCase();
  }).filter(Boolean);
  const unique = new Set(normalized);
  if (normalized.length !== value.length || unique.size !== normalized.length) {
    return { source, present: true, count: null, invalidReason: `${source}: stations vides ou dupliquées` };
  }
  const count = supportedCount(unique.size);
  return count
    ? { source, present: true, count }
    : { source, present: true, count: null, invalidReason: `${source}: panel ${unique.size} non supporté` };
};

const assignmentsCandidate = (value: readonly PanelAssignmentInput[] | undefined): Candidate => {
  if (value === undefined) return { source: 'assignments', present: false, count: null };
  if (value.length === 0) return { source: 'assignments', present: false, count: null };
  const stations = value.map((assignment) => String(assignment.station || '').trim().toUpperCase());
  const complete = value.every((assignment, index) => stations[index] && String(assignment.judgeId || '').trim());
  const uniqueStations = new Set(stations);
  if (!complete || uniqueStations.size !== value.length) {
    return { source: 'assignments', present: true, count: null, invalidReason: 'assignments: affectations incomplètes ou stations dupliquées' };
  }
  const count = supportedCount(uniqueStations.size);
  return count
    ? { source: 'assignments', present: true, count }
    : { source: 'assignments', present: true, count: null, invalidReason: `assignments: panel ${uniqueStations.size} non supporté` };
};

export function resolvePanelContext(input: ResolvePanelContextInput): PanelContext {
  void input.observedScoreCount;
  const candidates: Candidate[] = [
    judgesCandidate('heat_config', input.heatConfigJudges),
    assignmentsCandidate(input.assignments),
    judgesCandidate('runtime_snapshot', input.runtimeSnapshotJudges),
  ];
  const invalid = candidates.filter((candidate) => candidate.present && candidate.count === null);
  if (invalid.length) {
    const message = `Panel incohérent : ${invalid.map((candidate) => candidate.invalidReason).join(' ; ')}`;
    console.error('[P2 panel context invalid]', { message, candidates });
    return { judgeCount: null, source: 'unknown', issue: 'panel_invalid', message };
  }
  const valid = candidates.filter((candidate): candidate is Candidate & { count: SupportedPanelSize } => candidate.count !== null);
  const distinctCounts = new Set(valid.map((candidate) => candidate.count));
  if (distinctCounts.size > 1) {
    const message = `Conflit de panel : ${valid.map((candidate) => `${candidate.source}=${candidate.count}`).join(', ')}`;
    console.error('[P2 panel context conflict]', { message, candidates: valid });
    return { judgeCount: null, source: 'unknown', issue: 'panel_conflict', message };
  }
  const selected = valid[0];
  if (!selected) {
    return {
      judgeCount: null,
      source: 'unknown',
      issue: 'panel_unknown',
      message: 'Panel inconnu : aucune configuration 3/5 explicite disponible.',
    };
  }
  return { judgeCount: selected.count, source: selected.source };
}
