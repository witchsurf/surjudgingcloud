import { useState, useEffect } from 'react';
import { useRealtimeSync } from './useRealtimeSync';
import { initializeVpsSync, subscribeToVpsEvents, isVpsConnected } from '../services/vpsRealtime';
import type { HeatTimer, AppConfig } from '../types';

/**
 * HOOK DE SYNCHRONISATION HYBRIDE
 * 
 * Ce hook est le point d'entrée pour basculer entre Supabase et le VPS.
 * Par défaut (Ligue Pro), il utilise uniquement useRealtimeSync (Supabase).
 */
export const useHybridSync = () => {
  const supabaseSync = useRealtimeSync();
  const [useHybrid, setUseHybrid] = useState(false); // Garder à false pour la Ligue Pro

  // Variables d'environnement futures
  const vpsUrl = import.meta.env.VITE_VPS_URL;
  const vpsKey = import.meta.env.VITE_VPS_API_KEY;

  useEffect(() => {
    if (useHybrid && vpsUrl && vpsKey) {
      initializeVpsSync(vpsUrl, vpsKey);
    }
  }, [useHybrid, vpsUrl, vpsKey]);

  const subscribeToHeat = (
    heatId: string,
    onUpdate: (timer: HeatTimer, config: AppConfig | null, status: any) => void
  ) => {
    // Mode Hybride : On écoute les deux, mais le VPS a la priorité pour la mise à jour UI
    if (useHybrid && isVpsConnected()) {
      const unsubscribeVps = subscribeToVpsEvents(heatId, onUpdate);
      const unsubscribeSupabase = supabaseSync.subscribeToHeat(heatId, (t, c, s) => {
        // Optionnel : ne mettre à jour via Supabase que si le VPS est lent ou déco
        // Pour l'instant on laisse les deux pour la redondance
        onUpdate(t, c, s);
      });

      return () => {
        unsubscribeVps();
        unsubscribeSupabase();
      };
    }

    // Mode Standard (Ligue Pro)
    return supabaseSync.subscribeToHeat(heatId, onUpdate);
  };

  return {
    ...supabaseSync,
    subscribeToHeat,
    isHybridActive: useHybrid && isVpsConnected(),
    enableHybrid: () => setUseHybrid(true),
    disableHybrid: () => setUseHybrid(false),
  };
};
