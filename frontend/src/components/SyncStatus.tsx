import { useEffect, useState } from 'react';
import { Wifi, WifiOff, Cloud, CloudOff, AlertTriangle, CheckCircle, RefreshCw } from 'lucide-react';

interface SyncStatusProps {
  isOnline: boolean;
  supabaseEnabled?: boolean;
  lastSync: Date | null;
  pendingScores: number;
  syncError: string | null;
  onManualSync?: () => void;
  realtimeConnected?: boolean;
  realtimeLastUpdate?: Date | null;
}

function SyncStatus({
  isOnline,
  supabaseEnabled = true,
  lastSync,
  pendingScores,
  syncError,
  onManualSync,
  realtimeConnected = false,
  realtimeLastUpdate
}: SyncStatusProps) {
  const getStatusColor = () => {
    if (syncError) return 'text-red-600 bg-red-50 border-red-200';
    if (!supabaseEnabled) return 'text-blue-600 bg-blue-50 border-blue-200';
    if (!isOnline) return 'text-orange-600 bg-orange-50 border-orange-200';
    if (pendingScores > 0) return 'text-yellow-600 bg-yellow-50 border-yellow-200';
    return 'text-green-600 bg-green-50 border-green-200';
  };

  const getStatusIcon = () => {
    if (syncError) return <AlertTriangle className="w-4 h-4" />;
    if (!supabaseEnabled) return <Cloud className="w-4 h-4" />;
    if (!isOnline) return <WifiOff className="w-4 h-4" />;
    if (pendingScores > 0) return <CloudOff className="w-4 h-4" />;
    return <CheckCircle className="w-4 h-4" />;
  };

  const getStatusText = () => {
    if (syncError) {
      const friendlyMessage = syncError === 'Erreur inconnue'
        ? 'Aucune donnée disponible pour ce heat.'
        : syncError;
      return syncError === 'Erreur inconnue' ? friendlyMessage : `Erreur: ${friendlyMessage}`;
    }
    if (!supabaseEnabled) return 'Mode local (Supabase désactivé)';
    if (!isOnline) return 'Mode hors ligne';
    if (pendingScores > 0) return `${pendingScores} score(s) en attente`;
    return realtimeConnected ? 'Synchronisé (Temps réel)' : 'Synchronisé';
  };

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg border ${getStatusColor()}`}>
      <div className="flex items-center space-x-2">
        {getStatusIcon()}
        <div>
          <div className="font-medium text-sm">{getStatusText()}</div>
          {lastSync && (
            <div className="text-xs opacity-75">
              Dernière sync: {lastSync.toLocaleTimeString('fr-FR')}
            </div>
          )}
          {realtimeConnected && realtimeLastUpdate && (
            <div className="text-xs opacity-75 text-green-600">
              Temps réel: {realtimeLastUpdate.toLocaleTimeString('fr-FR')}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-2">
        {/* Indicateur de connexion */}
        <div className="flex items-center space-x-1">
          {isOnline ? (
            <Wifi className="w-4 h-4 text-green-600" />
          ) : (
            <WifiOff className="w-4 h-4 text-red-600" />
          )}
          <span className="text-xs">
            {isOnline ? 'En ligne' : 'Hors ligne'}
          </span>
        </div>

        {/* Bouton de synchronisation manuelle */}
        {onManualSync && isOnline && pendingScores > 0 && (
          <button
            onClick={onManualSync}
            className="p-1 rounded hover:bg-white/50 transition-colors"
            title="Synchroniser maintenant"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default SyncStatus;
