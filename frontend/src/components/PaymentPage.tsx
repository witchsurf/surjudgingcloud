import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

type PaymentMethod = 'stripe' | 'orange-money' | 'wave';

const PaymentPage = () => {
  const navigate = useNavigate();
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);

  const eventData = JSON.parse(localStorage.getItem('eventData') || '{}');
  const amount = 50000; // 50,000 FCFA

  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    if (!selectedMethod) return;

    if (selectedMethod === 'stripe') {
      try {
        setLoading(true);
        const { data, error } = await supabase.functions.invoke('payments', {
          body: {
            action: 'initiate',
            amount: amount,
            currency: 'xof',
            event_name: eventData.name,
            organizer: eventData.organizer,
            // Add other necessary fields from eventData if available
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
      return;
    }

    // Simulate payment processing for other methods
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      // After successful payment, navigate to participants page
      navigate('/participants');
    }, 1000);
  };

  const handleTestMode = () => {
    navigate('/participants');
  };

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

          <button
            onClick={handleTestMode}
            className="w-full py-4 rounded-lg border border-dashed border-gray-600 text-gray-400 hover:text-white hover:border-gray-400"
          >
            Activer en mode test
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentPage;