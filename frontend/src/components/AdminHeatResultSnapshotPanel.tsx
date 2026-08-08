import type { HeatResultSnapshot } from '../domain/scoring/contracts';
import type { OverlayScoringIssue } from '../domain/scoring/overlaySnapshot';

interface AdminHeatResultSnapshotPanelProps {
  snapshot: HeatResultSnapshot | null;
  issue: OverlayScoringIssue | null;
  message: string | null;
  surferNames?: Readonly<Record<string, string>>;
}

export default function AdminHeatResultSnapshotPanel({
  snapshot,
  issue,
  message,
  surferNames = {},
}: AdminHeatResultSnapshotPanelProps) {
  return (
    <section data-admin-heat-result className="neon-card overflow-hidden rounded-2xl border border-white/5 bg-slate-950/40 shadow-2xl">
      <header className="border-b border-white/5 bg-slate-950/80 px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-widest text-cyan-300">Résultat canonique du heat</h2>
        <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">Snapshot P2 validé par comparaison legacy</p>
      </header>

      {message ? (
        <div
          role="alert"
          data-admin-scoring-state={issue || 'panel_unknown'}
          className="border-b border-amber-700/50 bg-amber-950/40 px-4 py-3 text-xs font-bold text-amber-200"
        >
          {message}
        </div>
      ) : null}

      {snapshot ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-2">Rang</th>
                <th className="px-4 py-2">Lycra / participant</th>
                <th className="px-4 py-2">Vagues</th>
                <th className="px-4 py-2">Best two</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Pénalité</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.competitors.map((competitor) => {
                const waveByNumber = new Map(competitor.waves.map((wave) => [wave.waveNumber, wave]));
                return (
                  <tr
                    key={competitor.lycraColor}
                    data-admin-result-lycra={competitor.lycraColor}
                    data-admin-result-rank={competitor.rank}
                    className="border-t border-white/5 text-slate-200"
                  >
                    <td className="px-4 py-3 font-mono text-lg font-black text-cyan-300">{competitor.rank}</td>
                    <td className="px-4 py-3">
                      <span className="block font-black">{competitor.lycraColor}</span>
                      <span className="block text-[10px] text-slate-500">{surferNames[competitor.lycraColor] || competitor.lycraColor}</span>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {competitor.waves.map((wave) => (
                        <span key={wave.waveNumber} className="mr-2 inline-block">
                          V{wave.waveNumber}:{wave.average.toFixed(2)}{wave.complete ? '' : '*'}
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold">
                      {competitor.bestWaveNumbers.map((waveNumber) => waveByNumber.get(waveNumber)?.average.toFixed(2) || '--').join(' + ') || '--'}
                    </td>
                    <td className="px-4 py-3 font-mono text-lg font-black">{competitor.total.toFixed(2)}</td>
                    <td className="px-4 py-3 font-bold">
                      {competitor.disqualified
                        ? 'DISQUALIFIÉ'
                        : competitor.interferenceType
                          ? `${competitor.interferenceType} (${competitor.interferenceCount})`
                          : '--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[9px] text-slate-500">* vague incomplète, exclue du total</p>
        </div>
      ) : null}
    </section>
  );
}
