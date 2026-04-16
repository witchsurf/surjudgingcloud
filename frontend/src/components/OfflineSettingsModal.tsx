import React, { useState, useEffect } from 'react';
import { X, Lock, ShieldCheck, AlertCircle } from 'lucide-react';
import { setOfflinePin, hasOfflinePin } from '../lib/offlineAuth';

interface OfflineSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

export const OfflineSettingsModal: React.FC<OfflineSettingsModalProps> = ({ isOpen, onClose, userEmail }) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setHasPin(hasOfflinePin());
      setSuccess(false);
      setError(null);
      setPin('');
      setConfirmPin('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (pin.length !== 4 || !/^\d+$/.test(pin)) {
      setError('Le code PIN doit comporter exactement 4 chiffres.');
      return;
    }

    if (pin !== confirmPin) {
      setError('Les codes PIN ne correspondent pas.');
      return;
    }

    try {
      setOfflinePin(pin);
      setSuccess(true);
      setHasPin(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      setError('Une erreur est survenue lors de l\'enregistrement.');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="p-8">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-3 bg-blue-500/20 rounded-2xl">
              <Lock className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Accès Hors-Ligne</h2>
              <p className="text-xs text-slate-400 truncate max-w-[200px]">{userEmail}</p>
            </div>
          </div>

          {success ? (
            <div className="py-8 text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/20 rounded-full mb-2">
                <ShieldCheck className="w-8 h-8 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Code PIN enregistré !</h3>
              <p className="text-sm text-slate-400">Vous pourrez l'utiliser à la plage.</p>
            </div>
          ) : (
            <form onSubmit={handleSavePin} className="space-y-6">
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  Configurez un code à 4 chiffres pour déverrouiller l'application sans connexion Internet.
                </p>

                {hasPin && (
                  <div className="px-4 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center space-x-3">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span className="text-xs text-blue-200 font-medium">Un code PIN est déjà configuré.</span>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Nouveau PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="****"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-2xl tracking-[1em] text-center text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-400">Confirmer le PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="****"
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-2xl tracking-[1em] text-center text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-center space-x-2 text-red-400 bg-red-400/10 p-3 rounded-xl border border-red-400/20">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs">{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98]"
              >
                Enregistrer le PIN
              </button>
              
              <p className="text-[10px] text-center text-slate-500 uppercase tracking-widest">
                Valide uniquement sur cet appareil
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
