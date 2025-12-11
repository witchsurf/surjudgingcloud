import type { RoundSpec } from '../utils/bracket';
import { colorLabelMap, colorHexMap, colorGradientMap } from '../utils/colorUtils';

interface BracketPreviewProps {
  rounds: RoundSpec[];
  repechage?: RoundSpec[];
  onExportPdf: () => void;
  onExportCsv: () => void;
}

export default function BracketPreview({ rounds, repechage, onExportPdf, onExportCsv }: BracketPreviewProps) {
  if (!rounds.length) {
    return null;
  }

  const slugify = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'round';

  const renderHeatCard = (roundName: string, heat: RoundSpec['heats'][number]) => (
    <div
      key={`${roundName}-${heat.heatNumber}`}
      className="bg-slate-900/60 my-3 flex flex-col gap-3 rounded-2xl p-4 text-center shadow-md shadow-slate-800"
    >
      <div className="text-sm font-bold uppercase tracking-wide text-sky-400">
        {`Heat ${heat.heatNumber} — ${heat.slots.length} surfeurs`}
      </div>
      <div className="flex flex-col gap-3">
        {[...heat.slots]
          .map((slot, idx) => ({ slot, idx }))
          .sort((a, b) => {
            const statusPriority = (entry: typeof a) => {
              if (entry.slot.placeholder && entry.slot.placeholder.startsWith('R')) return 2;
              if (entry.slot.placeholder) return 1;
              return 0;
            };
            const statusDiff = statusPriority(a) - statusPriority(b);
            if (statusDiff !== 0) return statusDiff;
            return a.idx - b.idx;
          })
          .map(({ slot, idx }) => {
            const colorKey = slot.color as keyof typeof colorLabelMap | undefined;
            const colorLabel = colorKey ? colorLabelMap[colorKey] : `COULOIR ${idx + 1}`;
            const primaryColor = colorKey ? colorHexMap[colorKey] : '#94a3b8';
            const gradientColor = colorKey ? colorGradientMap[colorKey] : 'linear-gradient(90deg, rgba(148,163,184,0.8) 0%, rgba(71,85,105,0.8) 100%)';
            const athleteLabel = slot.placeholder
              ? slot.placeholder
              : `${slot.name ?? 'TBD'}${slot.country ? ` (${slot.country})` : ''}`;

          return (
            <div
              key={`${heat.heatNumber}-${idx}`}
              className="relative overflow-hidden rounded-xl border border-white/10 shadow transition"
              style={{ background: gradientColor }}
            >
              <div className="flex flex-col items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-white sm:flex-row">
                <div className="flex items-center gap-3 uppercase tracking-wide">
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-white/50 shadow"
                    style={{ backgroundColor: primaryColor }}
                  />
                  <span>{colorLabel}</span>
                </div>
                <div className="text-center text-sm font-medium sm:text-base">
                  {athleteLabel}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderRound = (round: RoundSpec, keyPrefix = 'main') => (
    <div
      key={`${keyPrefix}-${round.roundNumber}`}
      id={`${keyPrefix}-${slugify(round.name)}`}
      className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-blue-500/10"
    >
      <h4 className="mb-3 text-center text-lg font-bold uppercase tracking-widest text-sky-400">{round.name}</h4>
      <div className="mt-2 grid gap-4 md:grid-cols-2">
        {round.heats.map((heat) => renderHeatCard(round.name, heat))}
      </div>
    </div>
  );

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-blue-500/10">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Prévisualisation des heats</h2>
          <p className="text-xs text-slate-400">Structure automatique selon le format sélectionné.</p>
        </div>
        <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onExportPdf}
            className="rounded-full border border-sky-500 px-4 py-2 font-semibold text-sky-300 transition hover:bg-sky-500/10"
          >
            Exporter PDF
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            className="rounded-full border border-sky-500 px-4 py-2 font-semibold text-sky-300 transition hover:bg-sky-500/10"
          >
            Exporter CSV
          </button>
        </div>
      </div>

      <div className="space-y-6 px-4 py-6 sm:px-6">
        {rounds.map((round) => renderRound(round))}
        {(repechage ?? []).length > 0 && (
          <div className="space-y-4">
            <h3 className="text-center text-lg font-bold uppercase tracking-widest text-amber-200">Repêchage</h3>
            {repechage!.map((round) => renderRound(round, 'rep'))}
          </div>
        )}
      </div>
    </div>
  );
}
