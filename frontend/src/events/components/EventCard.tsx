import type { EventRecord, PaymentRecord } from '../../types';
import { PaymentOptions } from './PaymentOptions';

interface EventCardProps {
  event: EventRecord & { payments: PaymentRecord[] };
  onRefresh: () => Promise<void>;
}

const statusStyles: Record<EventRecord['status'], string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export function EventCard({ event, onRefresh }: EventCardProps) {
  const statusLabel =
    event.status === 'pending'
      ? 'Licence en attente'
      : event.status === 'paid'
        ? 'Licence active'
        : 'Paiement rejeté';

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md">
      <div className="border-b border-gray-100 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-gray-900">{event.name}</h3>
            <p className="text-sm text-gray-500">Organisé par {event.organizer}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase ${statusStyles[event.status]}`}>
              {statusLabel}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
              {Number(event.price).toLocaleString('fr-FR', {
                style: 'currency',
                currency: event.currency ?? 'XOF',
              })}
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Organisation</h4>
            <p className="mt-1 text-sm text-gray-800">{event.organizer}</p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Date d’activation</h4>
            <p className="mt-1 text-sm text-gray-800">
              {new Date(event.created_at).toLocaleString('fr-FR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Licence générée le</h4>
            <p className="mt-1 text-sm text-gray-800">
              {new Date(event.created_at).toLocaleString('fr-FR', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
          </div>
        </div>

        <PaymentOptions event={event} onRefresh={onRefresh} />
      </div>
    </div>
  );
}
