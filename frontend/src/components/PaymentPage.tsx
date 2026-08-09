import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { parseCanonicalEventId, resolveEventWorkflowState } from '../domain/eventWorkflow';
import { getDeploymentMode } from '../domain/deploymentMode';
import { eventRepository } from '../repositories/EventRepository';

type PaymentMethod = 'stripe' | 'orange-money' | 'wave';

const PaymentPage = () => {
  const navigate = useNavigate();
  const deploymentMode = getDeploymentMode();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
  const amount = 50000; // 50,000 FCFA
  const canonicalEventId = parseCanonicalEventId(eventData.eventDbId ?? eventData.id);

  const [loading, setLoading] = useState(false);
  const [loadingTestActivation, setLoadingTestActivation] = useState(false);
  const [canActivateForTest, setCanActivateForTest] = useState(false);
  const [testActivationError, setTestActivationError] = useState<string | null>(null);

  useEffect(() => {
    if (deploymentMode !== 'field') return;
    if (canonicalEventId) {
      navigate(`/participants?eventId=${canonicalEventId}&eventName=${encodeURIComponent(String(eventData.name ?? ''))}`, { replace: true });
    } else {
      navigate('/my-events', { replace: true });
    }
  }, [canonicalEventId, deploymentMode, eventData.name, navigate]);

  useEffect(() => {
    let cancelled = false;
    if (deploymentMode !== 'cloud' || !canonicalEventId) return undefined;
    void eventRepository.canActivateForTest(canonicalEventId)
      .then((allowed) => { if (!cancelled) setCanActivateForTest(allowed); })
      .catch(() => { if (!cancelled) setCanActivateForTest(false); });
    return () => { cancelled = true; };
  }, [canonicalEventId, deploymentMode]);

  const handlePayment = async () => {
    if (!selectedMethod) return;
    if (deploymentMode !== 'cloud') return;
    if (!canonicalEventId) {
      alert("L’événement doit d’abord être sauvegardé dans la base Cloud.");
      return;
    }
    if (!supabase) {
      alert('Supabase n’est pas configuré. Paiement indisponible en mode hors‑ligne.');
      return;
    }

    try {
        setLoading(true);
        const { data, error } = await supabase.functions.invoke('payments', {
          body: {
            action: 'initiate',
            eventId: canonicalEventId,
            provider: selectedMethod === 'orange-money' ? 'orange_money' : selectedMethod,
            amount: amount,
            currency: 'xof',
            event_name: eventData.name,
            organizer: eventData.organizer,
            successUrl: `${window.location.origin}/participants?eventId=${canonicalEventId}`,
            cancelUrl: `${window.location.origin}/payment?eventId=${canonicalEventId}`,
          },
        });

        if (error) throw error;

        if (data?.checkoutUrl) {
          window.location.href = data.checkoutUrl;
        } else {
          throw new Error('No checkout URL received');
        }
    } catch (err) {
        console.error('Payment initiation failed:', err);
        alert('Erreur lors de l\'initialisation du paiement. Veuillez réessayer.');
        setLoading(false);
    }
  };

  const handleTestActivation = async () => {
    if (deploymentMode !== 'cloud' || !canonicalEventId || !canActivateForTest || !supabase) return;
    setLoadingTestActivation(true);
    setTestActivationError(null);
    try {
      await eventRepository.activateForTest(canonicalEventId);
      const { data, error } = await supabase
        .from('events')
        .select('id, paid, status, test_activated_at, test_activated_by')
        .eq('id', canonicalEventId)
        .maybeSingle();
      if (error) throw error;
      if (resolveEventWorkflowState(data).paymentStatus !== 'test_activated') {
        throw new Error("L’activation test n’a pas été confirmée par la base.");
      }
      setCanActivateForTest(false);
      navigate(`/participants?eventId=${canonicalEventId}&eventName=${encodeURIComponent(String(eventData.name ?? ''))}`);
    } catch (error) {
      setTestActivationError(error instanceof Error ? error.message : "Échec de l’activation test.");
    } finally {
      setLoadingTestActivation(false);
    }
  };

  if (deploymentMode === 'field') return null;

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container mx-auto px-4 py-12">
        <button
          onClick={() => navigate(-1)}
          className="mb-8 text-blue-400 flex items-center"
        >
          ← Retour
        </button>

        <div className="max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold mb-2">{eventData.name}</h1>
          <p className="text-gray-400 mb-8">Organisé par {eventData.organizer}</p>

          <div className="bg-gray-800 rounded-lg p-6 mb-8">
            <p className="text-lg font-medium mb-2">MONTANT</p>
            <p className="text-3xl font-bold text-blue-400">{amount.toLocaleString()} FCFA</p>
          </div>

          <h2 className="text-xl font-medium mb-4">Choisissez une méthode de paiement :</h2>

          <div className="grid gap-4 mb-8">
            <button
              onClick={() => setSelectedMethod('stripe')}
              className={`flex items-center p-4 rounded-lg border ${selectedMethod === 'stripe'
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-blue-500'
                }`}
            >
              <span className="text-2xl mr-3">💳</span>
              <span>Carte bancaire (Stripe)</span>
            </button>

            <button
              onClick={() => setSelectedMethod('orange-money')}
              className={`flex items-center p-4 rounded-lg border ${selectedMethod === 'orange-money'
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-blue-500'
                }`}
            >
              <span className="text-2xl mr-3">📱</span>
              <span>Orange Money</span>
            </button>

            <button
              onClick={() => setSelectedMethod('wave')}
              className={`flex items-center p-4 rounded-lg border ${selectedMethod === 'wave'
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-gray-700 hover:border-blue-500'
                }`}
            >
              <span className="text-2xl mr-3">🌊</span>
              <span>Wave</span>
            </button>
          </div>

          <button
            onClick={handlePayment}
            disabled={!selectedMethod || loading}
            className={`w-full py-4 rounded-lg font-medium mb-4 ${selectedMethod
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-700 cursor-not-allowed'
              }`}
          >
            {loading ? 'Traitement en cours...' : 'Procéder au paiement'}
          </button>

          {canActivateForTest && (
            <div className="mt-6 rounded-lg border border-amber-400 bg-amber-500/10 p-4">
              <p className="text-sm text-amber-100">
                Capacité Cloud réservée aux validations autorisées. Aucun paiement Stripe ne sera enregistré.
              </p>
              {testActivationError && <p className="mt-2 text-sm text-red-300">{testActivationError}</p>}
              <button
                type="button"
                onClick={handleTestActivation}
                disabled={loadingTestActivation}
                className="mt-4 w-full rounded-lg border border-amber-300 px-4 py-3 font-semibold text-amber-100 hover:bg-amber-400/10 disabled:opacity-60"
              >
                {loadingTestActivation
                  ? 'Activation test en cours…'
                  : 'Activer pour test — aucun paiement réel'}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default PaymentPage;
