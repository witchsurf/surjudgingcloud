import { useState } from 'react';
import type { NewEventInput } from '../../events/api';

interface EventFormProps {
  onSubmit: (input: NewEventInput) => Promise<boolean>;
  submitting: boolean;
  defaultCurrency?: string;
}

const DEFAULT_CURRENCY = 'XOF';

export function EventForm({ onSubmit, submitting, defaultCurrency = DEFAULT_CURRENCY }: EventFormProps) {
  const [name, setName] = useState('');
  const [organizer, setOrganizer] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Le nom de l'événement est obligatoire.");
      return;
    }
    if (!organizer.trim()) {
      setError("Le nom de l'organisateur est obligatoire.");
      return;
    }
    if (!startDate || !endDate) {
      setError("La période de début/fin est obligatoire.");
      return;
    }
    if (new Date(startDate) > new Date(endDate)) {
      setError("La date de fin doit être postérieure à la date de début.");
      return;
    }

    const payload: NewEventInput = {
      name: name.trim(),
      organizer: organizer.trim(),
      start_date: startDate,
      end_date: endDate,
      price: 0, // Will be set during payment if needed
      currency: defaultCurrency,
      categories: [], // Will be configured later
      judges: [], // Will be configured later
    };

    const success = await onSubmit(payload);

    if (success) {
      setName('');
      setOrganizer('');
      setStartDate('');
      setEndDate('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-gray-700">Nom de l'événement</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Championnat national de surf"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Organisateur</label>
          <input
            type="text"
            value={organizer}
            onChange={(event) => setOrganizer(event.target.value)}
            placeholder="Fédération Sénégalaise de Surf"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Date de début</label>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700">Date de fin</label>
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          disabled={submitting}
        >
          {submitting ? "Création..." : "Créer l'événement"}
        </button>
      </div>
    </form>
  );
}
