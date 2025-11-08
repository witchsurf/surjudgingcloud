import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../lib/supabase';

export default function EventStatus() {
  const navigate = useNavigate();
  const [eventData, setEventData] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const ev = JSON.parse(localStorage.getItem('eventData') || 'null');
      setEventData(ev || null);
    } catch (err) {
      setEventData(null);
    }
  }, []);

  const retrySave = async () => {
    if (!eventData) return;
    if (!isSupabaseConfigured() || !supabase) {
      setMessage('Supabase non configuré');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const { data, error } = await supabase
        .from('events')
        .insert({
          name: eventData.name,
          organizer: eventData.organizer,
          start_date: eventData.startDate,
          end_date: eventData.endDate,
          price: eventData.price || 0,
          currency: eventData.currency || 'XOF'
        })
        .select('id')
        .single();

      if (error) throw error;
      if (data && data.id) {
        const updated = { ...eventData, eventDbId: data.id };
        localStorage.setItem('eventData', JSON.stringify(updated));
        setEventData(updated);
        setMessage('Enregistré en base');
      }
    } catch (err: any) {
      setMessage(err?.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  if (!eventData) return null;

  return (
    <div className="flex items-center space-x-3">
      <div>
        <div className="text-sm font-medium">Événement</div>
        <div className="text-xs text-gray-400">{eventData.name || eventData.eventId}</div>
      </div>
      <div>
        {eventData.eventDbId ? (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-100 text-green-800 text-sm">Sauvé en DB #{eventData.eventDbId}</span>
        ) : (
          <span className="inline-flex items-center px-2 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">Non sauvegardé</span>
        )}
      </div>
      {!eventData.eventDbId && (
        <button
          onClick={retrySave}
          disabled={saving}
          className="ml-2 px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 text-sm"
        >
          {saving ? 'Enregistrement...' : 'Sauver en DB'}
        </button>
      )}
      {message && <div className="text-sm text-gray-500 ml-3">{message}</div>}
        {eventData.eventDbId && (
          <button
            onClick={() => navigate('/chief-judge')}
            className="ml-auto px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm"
          >
            Interface Chef Juge
          </button>
        )}
      </div>
  );
}
