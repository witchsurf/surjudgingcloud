import { useMemo, useState } from 'react';
import type { ParticipantRecord } from '../api/supabaseClient';

interface ParticipantsTableProps {
  participants: ParticipantRecord[];
  categories: string[];
  selectedCategory: string | null;
  onCategoryChange: (value: string | null) => void;
  onUpdate: (participant: ParticipantRecord) => Promise<void> | void;
  onDelete: (participant: ParticipantRecord) => Promise<void> | void;
  onExport: () => void;
}

interface EditableState {
  id: number;
  draft: ParticipantRecord;
}

export default function ParticipantsTable({
  participants,
  categories,
  selectedCategory,
  onCategoryChange,
  onUpdate,
  onDelete,
  onExport,
}: ParticipantsTableProps) {
  const [editing, setEditing] = useState<EditableState | null>(null);
  const filtered = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'ALL') return participants;
    return participants.filter((row) => row.category === selectedCategory);
  }, [participants, selectedCategory]);

  const startEdit = (participant: ParticipantRecord) => {
    setEditing({ id: participant.id, draft: { ...participant } });
  };

  const cancelEdit = () => setEditing(null);

  const commitEdit = async () => {
    if (!editing) return;
    await onUpdate(editing.draft);
    setEditing(null);
  };

  const handleChange = (field: keyof ParticipantRecord, value: string) => {
    if (!editing) return;
    let nextValue: string | number | undefined = value;
    if (field === 'seed') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) nextValue = numeric;
    }
    setEditing({ ...editing, draft: { ...editing.draft, [field]: nextValue } });
  };

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/70 shadow-xl shadow-blue-500/10">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Participants</h2>
          <p className="text-xs text-slate-400">Editer, filtrer et exporter la liste actuelle.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedCategory ?? 'ALL'}
            onChange={(event) => onCategoryChange(event.target.value === 'ALL' ? null : event.target.value)}
            className="rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
          >
            <option value="ALL">Toutes les catégories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onExport}
            className="rounded-full border border-blue-500/80 px-4 py-2 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/10"
          >
            Exporter CSV
          </button>
        </div>
      </div>

      <div className="hidden max-h-[420px] overflow-auto px-6 py-4 md:block">
        <table className="min-w-full table-fixed text-left text-sm text-slate-200">
          <thead className="border-b border-slate-700 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="w-16 py-2">Seed</th>
              <th className="w-48 py-2">Nom</th>
              <th className="w-32 py-2">Pays / Club</th>
              <th className="w-32 py-2">Licence</th>
              <th className="w-32 py-2">Catégorie</th>
              <th className="w-32 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((participant) => {
              const isEditing = editing?.id === participant.id;
              return (
                <tr key={participant.id} className="border-b border-slate-800/60">
                  <td className="py-2 pr-4">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editing?.draft.seed ?? ''}
                        onChange={(event) => handleChange('seed', event.target.value)}
                        className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      <span className="font-semibold text-white">{participant.seed}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.name ?? ''}
                        onChange={(event) => handleChange('name', event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      participant.name
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.country ?? ''}
                        onChange={(event) => handleChange('country', event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      participant.country ?? '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.license ?? ''}
                        onChange={(event) => handleChange('license', event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      participant.license ?? '—'
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.category ?? ''}
                        onChange={(event) => handleChange('category', event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      participant.category
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {isEditing ? (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={commitEdit}
                          className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400"
                        >
                          Sauver
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="rounded-full bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600"
                        >
                          Annuler
                        </button>
                      </div>
                    ) : (
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(participant)}
                          className="rounded-full bg-blue-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-400"
                        >
                          Éditer
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(participant)}
                          className="rounded-full bg-red-500/80 px-3 py-1 text-xs font-semibold text-white hover:bg-red-400"
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-slate-400">
                  Aucun participant pour cette catégorie.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 px-4 py-4 md:hidden">
        {filtered.map((participant) => {
          const isEditing = editing?.id === participant.id;
          return (
            <div key={participant.id} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-sm">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-widest text-slate-400">Seed</span>
                  {isEditing ? (
                    <input
                      type="number"
                      value={editing?.draft.seed ?? ''}
                      onChange={(event) => handleChange('seed', event.target.value)}
                      className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100 focus:border-blue-400 focus:outline-none"
                    />
                  ) : (
                    <span className="text-lg font-semibold text-white">{participant.seed}</span>
                  )}
                </div>

                <div>
                  <span className="text-xs uppercase tracking-widest text-slate-400">Nom</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editing?.draft.name ?? ''}
                      onChange={(event) => handleChange('name', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-400 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-base font-semibold text-white">{participant.name}</p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs uppercase tracking-widest text-slate-400">Pays / Club</span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.country ?? ''}
                        onChange={(event) => handleChange('country', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-slate-200">{participant.country ?? '—'}</p>
                    )}
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-widest text-slate-400">Licence</span>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editing?.draft.license ?? ''}
                        onChange={(event) => handleChange('license', event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-400 focus:outline-none"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-slate-200">{participant.license ?? '—'}</p>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-xs uppercase tracking-widest text-slate-400">Catégorie</span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editing?.draft.category ?? ''}
                      onChange={(event) => handleChange('category', event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 focus:border-blue-400 focus:outline-none"
                    />
                  ) : (
                    <p className="mt-1 text-sm text-slate-200">{participant.category}</p>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={commitEdit}
                        className="rounded-full bg-emerald-500 px-4 py-1 text-xs font-semibold text-white hover:bg-emerald-400"
                      >
                        Sauver
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded-full bg-slate-700 px-4 py-1 text-xs font-semibold text-white hover:bg-slate-600"
                      >
                        Annuler
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(participant)}
                        className="rounded-full bg-blue-500/80 px-4 py-1 text-xs font-semibold text-white hover:bg-blue-400"
                      >
                        Éditer
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(participant)}
                        className="rounded-full bg-red-500/80 px-4 py-1 text-xs font-semibold text-white hover:bg-red-400"
                      >
                        Supprimer
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <p className="text-center text-xs text-slate-400">Aucun participant pour cette catégorie.</p>
        )}
      </div>
    </div>
  );
}
