import { useMemo, useState } from 'react';
import type { EventRecord, PaymentRecord, PaymentProvider } from '../../types';
import { confirmPayment, initiatePayment } from '../../events/api';

const providerLabels: Record<PaymentProvider, string> = {
  stripe: 'Carte bancaire (Stripe)',
  orange_money: 'Orange Money',
  wave: 'Wave',
};

interface PaymentOptionsProps {
  event: EventRecord & { payments: PaymentRecord[] };
  onRefresh: () => Promise<void> | void;
}

const DEFAULT_PROVIDER: PaymentProvider = 'stripe';

export function PaymentOptions({ event, onRefresh }: PaymentOptionsProps) {
  const [selectedProvider, setSelectedProvider] = useState<PaymentProvider>(DEFAULT_PROVIDER);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [processing, setProcessing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualRef, setManualRef] = useState('');

  const lastPayment = useMemo(() => event.payments.length > 0 ? event.payments[event.payments.length - 1] : null, [event.payments]);
  const needsPhone = selectedProvider === 'orange_money' || selectedProvider === 'wave';

  const successUrl = useMemo(() => {
    const url = new URL(window.location.origin + '/events');
    url.searchParams.set('payment', 'success');
    url.searchParams.set('provider', selectedProvider);
    url.searchParams.set('event_id', String(event.id));
    return url.toString();
  }, [event.id, selectedProvider]);

  const cancelUrl = useMemo(() => {
    const url = new URL(window.location.origin + '/events');
    url.searchParams.set('payment', 'cancel');
    url.searchParams.set('event_id', String(event.id));
    return url.toString();
  }, [event.id]);

  const handlePayment = async () => {
    setProcessing(true);
    setMessage(null);
    setError(null);

    if (needsPhone && !phoneNumber.trim()) {
      setError('Veuillez indiquer le numéro de téléphone à débiter.');
      setProcessing(false);
      return;
    }

    try {
      const response = await initiatePayment({
        eventId: event.id,
        provider: selectedProvider,
        amount: event.price,
        currency: event.currency,
        phoneNumber: needsPhone ? phoneNumber.trim() : undefined,
        successUrl,
        cancelUrl,
      });

      if (response.provider === 'stripe' && response.checkoutUrl) {
        setMessage('Redirection vers la page de paiement sécurisée...');
        window.location.href = response.checkoutUrl;
        return;
      }

      if (response.instructions) {
        setMessage(response.instructions);
      } else {
        setMessage('Paiement démarré. Vérifiez votre téléphone pour confirmer la transaction.');
      }

      if (response.transactionRef) {
        setManualRef(response.transactionRef);
      }

      if (onRefresh) {
        await onRefresh();
      }
    } catch (err) {
      const description = err instanceof Error ? err.message : 'Impossible de démarrer le paiement.';
      setError(description);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
      <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-blue-800">Payer l’événement</h4>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-blue-700">Méthode de paiement</label>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {(Object.keys(providerLabels) as PaymentProvider[]).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => setSelectedProvider(provider)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${selectedProvider === provider
                    ? 'border-blue-500 bg-white text-blue-700 shadow-sm'
                    : 'border-transparent bg-blue-100/40 text-blue-700 hover:border-blue-400 hover:bg-white'
                  }`}
              >
                {providerLabels[provider]}
              </button>
            ))}
          </div>
        </div>

        {needsPhone && (
          <div>
            <label className="block text-xs font-semibold text-blue-700">Numéro Orange Money / Wave</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="Ex: 770001122"
              className="mt-1 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-xs text-blue-600">Le numéro doit être enregistré sur le service sélectionné.</p>
          </div>
        )}

        {message && (
          <div className="rounded-lg border border-blue-200 bg-white/70 px-3 py-2 text-sm text-blue-800">
            {message}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handlePayment}
          disabled={processing}
          className="inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {processing ? 'Démarrage du paiement...' : 'Procéder au paiement'}
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-blue-100 bg-white/70 p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-blue-700">Historique des paiements</h5>
        {event.payments.length === 0 && (
          <p className="mt-2 text-sm text-blue-600">Aucun paiement enregistré pour l’instant.</p>
        )}
        {event.payments.length > 0 && (
          <ul className="mt-2 space-y-2">
            {event.payments.map((payment) => (
              <li
                key={payment.id}
                className="rounded-md border border-blue-100 bg-blue-50/80 px-3 py-2 text-xs text-blue-700"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{providerLabels[payment.provider]}</span>
                  <span>
                    {Number(payment.amount).toLocaleString('fr-FR', {
                      style: 'currency',
                      currency: payment.currency ?? event.currency ?? 'XOF',
                    })}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] uppercase tracking-wide">
                  <span
                    className={`rounded-full px-2 py-0.5 ${payment.status === 'success'
                        ? 'bg-green-100 text-green-700'
                        : payment.status === 'failed'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                  >
                    {payment.status}
                  </span>
                  {payment.transaction_ref && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">
                      Ref: {payment.transaction_ref}
                    </span>
                  )}
                  <span>{new Date(payment.created_at).toLocaleString('fr-FR')}</span>
                </div>
                {payment.status === 'pending' && lastPayment?.id === payment.id && (
                  <p className="mt-1 text-[11px] text-blue-600">
                    Paiement en attente. N’oubliez pas de confirmer l’opération sur votre téléphone.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {lastPayment &&
          lastPayment.provider !== 'stripe' &&
          lastPayment.status === 'pending' && (
            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-xs text-blue-700">
              <p className="text-sm font-semibold text-blue-800">Confirmer manuellement</p>
              <p className="mt-1">
                Si la transaction est validée, indiquez la référence reçue par SMS ou ticket et confirmez ici pour
                activer l’événement.
              </p>
              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                <input
                  type="text"
                  value={manualRef}
                  onChange={(event) => setManualRef(event.target.value)}
                  placeholder="Référence de transaction"
                  className="flex-1 rounded-lg border border-blue-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (!manualRef.trim() && !lastPayment.transaction_ref) {
                      setError('Veuillez saisir une référence de transaction avant de confirmer.');
                      return;
                    }

                    setError(null);
                    setMessage(null);
                    setConfirming(true);
                    try {
                      await confirmPayment({
                        paymentId: lastPayment.id,
                        provider: lastPayment.provider,
                        transactionRef: manualRef || lastPayment.transaction_ref || undefined,
                        status: 'success',
                      });
                      setMessage('Paiement confirmé. Merci !');
                      await onRefresh();
                    } catch (err) {
                      const description =
                        err instanceof Error ? err.message : 'Impossible de confirmer le paiement.';
                      setError(description);
                    } finally {
                      setConfirming(false);
                    }
                  }}
                  disabled={confirming}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {confirming ? 'Confirmation...' : 'Confirmer'}
                </button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
