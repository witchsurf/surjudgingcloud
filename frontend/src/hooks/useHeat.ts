import { useState } from 'react';
import type { AppConfig, Heat, Score } from '../types';
import { buildHeatId } from '../utils/heat';

interface UseHeatReturn {
  currentHeat: Heat | null;
  loading: boolean;
  error: string | null;
  startHeat: () => Promise<void>;
  closeHeat: () => Promise<number>;
  overrideScore: (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => Promise<void>;
  clearError: () => void;
}

export function useHeat(config: AppConfig): UseHeatReturn {
  const [currentHeat, setCurrentHeat] = useState<Heat | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  const startHeat = async () => {
    if (!config.competition.trim()) {
      throw new Error('Configuration incomplète');
    }

    setLoading(true);
    setError(null);

    try {
      // Simuler la création d'un heat
      const heat: Heat = {
        id: buildHeatId(config.competition, config.division, config.round, config.heatId),
        competition: config.competition,
        division: config.division,
        round: config.round,
        heat_number: config.heatId,
        status: 'open',
        created_at: new Date().toISOString(),
        surfers: config.surfers.map(s => ({ color: s, name: s, country: '' }))
      };

      setCurrentHeat(heat);

      // Simuler un délai réseau
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const closeHeat = async (): Promise<number> => {
    if (!currentHeat) {
      throw new Error('Aucun heat actif');
    }

    setLoading(true);
    setError(null);

    try {
      // Simuler la fermeture du heat
      await new Promise(resolve => setTimeout(resolve, 1000));

      const closedHeat = {
        ...currentHeat,
        status: 'closed' as const,
        closed_at: new Date().toISOString()
      };

      setCurrentHeat(closedHeat);

      // Retourner le prochain heat ID
      return config.heatId + 1;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de la fermeture';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const overrideScore = async (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => {
    if (!currentHeat) {
      throw new Error('Aucun heat actif');
    }

    setLoading(true);
    setError(null);

    try {
      const score: Score = {
        ...scoreData,
        heat_id: currentHeat.id || '',
        timestamp: new Date().toISOString()
      };

      // Simuler la sauvegarde
      await new Promise(resolve => setTimeout(resolve, 500));

      console.log('Score écrasé:', score);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur lors de l\'override';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return {
    currentHeat,
    loading,
    error,
    startHeat,
    closeHeat,
    overrideScore,
    clearError
  };
}
