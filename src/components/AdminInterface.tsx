import React, { useState } from 'react';
import { Settings, Clock, Users, Waves, Download, RotateCcw, Trash2, Database, Wifi, WifiOff, CheckCircle, ArrowRight } from 'lucide-react';
import HeatTimer from './HeatTimer';
import type { AppConfig, HeatTimer as HeatTimerType } from '../types';
import { DEFAULT_TIMER_DURATION } from '../utils/constants';

interface AdminInterfaceProps {
  config: AppConfig;
  onConfigChange: (config: AppConfig) => void;
  onConfigSaved: (saved: boolean) => void;
  configSaved: boolean;
  timer: HeatTimerType;
  onTimerChange: (timer: HeatTimerType) => void;
  onReloadData: () => void;
  onResetAllData: () => void;
  onCloseHeat: () => void;
  judgeWorkCount: Record<string, number>;
  onRealtimeTimerStart?: (heatId: string, config: AppConfig, duration: number) => Promise<void>;
  onRealtimeTimerPause?: (heatId: string) => Promise<void>;
  onRealtimeTimerReset?: (heatId: string, duration: number) => Promise<void>;
}

const DIVISIONS = [
  'ONDINE',
  'OPEN', 
  'JUNIOR',
  'MINIME',
  'CADET',
  'BENJAMIN',
  'ONDINE U16'
];

const SURFER_COLORS = ['ROUGE', 'BLANC', 'JAUNE', 'BLEU', 'VERT', 'NOIR'];

const AdminInterface: React.FC<AdminInterfaceProps> = ({
  config,
  onConfigChange,
  onConfigSaved,
  configSaved,
  timer,
  onTimerChange,
  onReloadData,
  onResetAllData,
  onCloseHeat,
  judgeWorkCount,
  onRealtimeTimerStart,
  onRealtimeTimerPause,
  onRealtimeTimerReset
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dbStatus, setDbStatus] = useState<'connected' | 'disconnected' | 'checking'>('checking');

  // Simuler le statut de la base de données
  React.useEffect(() => {
    const checkDbStatus = () => {
      setTimeout(() => {
        setDbStatus(configSaved ? 'connected' : 'disconnected');
      }, 1000);
    };
    
    checkDbStatus();
  }, [configSaved]);

  const handleConfigChange = (field: keyof AppConfig, value: any) => {
    onConfigChange({ ...config, [field]: value });
  };

  const handleJudgeNameChange = (judgeId: string, name: string) => {
    onConfigChange({
      ...config,
      judgeNames: {
        ...config.judgeNames,
        [judgeId]: name
      }
    });
  };

  const setJudgeCount = (count: 3 | 5) => {
    const newJudges = Array.from({ length: count }, (_, i) => `J${i + 1}`);
    const newJudgeNames: Record<string, string> = {};
    
    // Conserver les noms existants
    newJudges.forEach(judgeId => {
      if (config.judgeNames[judgeId]) {
        newJudgeNames[judgeId] = config.judgeNames[judgeId];
      }
    });

    onConfigChange({
      ...config,
      judges: newJudges,
      judgeNames: newJudgeNames
    });
  };

  const setSurferCount = (count: 2 | 4 | 5 | 6) => {
    const newSurfers = SURFER_COLORS.slice(0, count);
    onConfigChange({
      ...config,
      surfers: newSurfers
    });
  };

  const handleSaveConfig = () => {
    onConfigSaved(true);
    // Sauvegarder immédiatement dans localStorage
    localStorage.setItem('surfJudgingConfig', JSON.stringify(config));
    localStorage.setItem('surfJudgingConfigSaved', 'true');
  };

  const handleTimerStart = () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    const newTimer = {
      ...timer,
      isRunning: true,
      startTime: new Date()
    };
    
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    
    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerStart && configSaved) {
      onRealtimeTimerStart(heatId, config, newTimer.duration)
        .then(() => {
          console.log('🚀 ADMIN: Timer START publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer START en mode local uniquement');
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }
    
    console.log('▶️ ADMIN: Timer démarré:', newTimer);
  };

  const handleTimerPause = () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    const newTimer = {
      ...timer,
      isRunning: false
    };
    
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    
    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerPause && configSaved) {
      onRealtimeTimerPause(heatId)
        .then(() => {
          console.log('⏸️ ADMIN: Timer PAUSE publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer PAUSE en mode local uniquement');
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }
    
    console.log('⏸️ ADMIN: Timer pausé:', newTimer);
  };

  const handleTimerReset = () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    const newTimer = {
      ...timer,
      isRunning: false,
      startTime: null
    };
    
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
    
    // Publier en temps réel via Supabase seulement si configuré
    if (onRealtimeTimerReset && configSaved) {
      onRealtimeTimerReset(heatId, newTimer.duration)
        .then(() => {
          console.log('🔄 ADMIN: Timer RESET publié en temps réel');
        })
        .catch((error) => {
          console.log('⚠️ ADMIN: Timer RESET en mode local uniquement');
          // Fallback sur l'ancien système
          window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
        });
    } else {
      // Fallback sur l'ancien système
      window.dispatchEvent(new CustomEvent('timerSync', { detail: newTimer }));
    }
    
    console.log('🔄 ADMIN: Timer reset:', newTimer);
  };

  const handleTimerDurationChange = (duration: number) => {
    const newTimer = {
      ...timer,
      duration
    };
    onTimerChange(newTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
  };

  const handleCloseHeat = () => {
    if (!confirm(`Fermer le Heat ${config.heatId} et passer au suivant ?`)) {
      return;
    }
    
    // Vérifier les juges qui travaillent beaucoup
    const overworkedJudges = Object.entries(judgeWorkCount)
      .filter(([_, count]) => count >= 4)
      .map(([judgeId, count]) => `${config.judgeNames[judgeId] || judgeId} (${count + 1} heats)`);
    
    if (overworkedJudges.length > 0) {
      const message = `⚠️ ATTENTION: Ces juges vont faire leur 5ème heat consécutif ou plus:\n\n${overworkedJudges.join('\n')}\n\nConsidérez une rotation des juges pour éviter la fatigue.`;
      alert(message);
    }
    
    onCloseHeat();
  };

  const handleResetAllData = () => {
    console.log('🗑️ RESET COMPLET DEPUIS ADMIN...');
    onResetAllData();
  };

  const generateJudgeLinks = () => {
    // Toujours utiliser l'URL actuelle pour éviter les redirections
    const baseUrl = window.location.origin;
    
    console.log('🔗 Génération des liens avec baseUrl:', baseUrl);
    
    return config.judges.map((judgeId) => {
      // Créer un identifiant unique basé sur la config complète
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
      const uniqueCode = btoa(`${heatId}_${judgeId}`).replace(/[+/=]/g, '').substring(0, 12);
      
      console.log('🔗 Génération lien pour juge:', { judgeId, heatId, uniqueCode });
      
      // Créer des liens avec la config encodée pour partage
      const configData = {
        competition: config.competition,
        division: config.division,
        round: config.round,
        heatId: config.heatId,
        judges: config.judges,
        surfers: config.surfers,
        waves: config.waves,
        judgeNames: config.judgeNames,
        configSaved: true,
        heatUniqueId: heatId
      };
      
      const encodedConfig = btoa(JSON.stringify(configData));
      const url = `${baseUrl}?judge=${judgeId}&heat=${uniqueCode}&config=${encodedConfig}`;
      
      console.log('🔗 URL générée:', url);
      
      return {
        judgeId,
        judgeName: config.judgeNames[judgeId] || judgeId,
        url,
        uniqueCode,
        heatId
      };
    });
  };

  const exportData = () => {
    const data = {
      config,
      timer,
      exportDate: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surf-judging-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Statut de la base de données */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Database className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-900">Statut de la base de données</span>
          </div>
          <div className="flex items-center space-x-2">
            {dbStatus === 'checking' && (
              <>
                <Wifi className="w-4 h-4 text-yellow-500 animate-pulse" />
                <span className="text-sm text-yellow-600">Vérification...</span>
              </>
            )}
            {dbStatus === 'connected' && (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600">Connecté</span>
              </>
            )}
            {dbStatus === 'disconnected' && (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-sm text-red-600">Déconnecté</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Configuration principale */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-6">
          <Settings className="w-6 h-6 text-blue-600" />
          <h2 className="text-xl font-semibold text-gray-900">Configuration de la Compétition</h2>
          <div className="ml-auto">
            <button
              onClick={() => {
                if (confirm('🧹 Nettoyer toutes les données et recommencer ?')) {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.reload();
                }
              }}
              className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
            >
              🧹 Reset Complet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nom de la compétition
            </label>
            <input
              type="text"
              value={config.competition}
              onChange={(e) => handleConfigChange('competition', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ex: Championnat de France"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Division
            </label>
            <select
              value={config.division}
              onChange={(e) => handleConfigChange('division', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Sélectionner une division --</option>
              {DIVISIONS.map(division => (
                <option key={division} value={division}>
                  {division}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Round</label>
            <input
              type="number"
              min="1"
              value={config.round}
              onChange={(e) => handleConfigChange('round', parseInt(e.target.value) || 1)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Heat #</label>
            <input
              type="number"
              min="1"
              value={config.heatId}
              onChange={(e) => handleConfigChange('heatId', parseInt(e.target.value) || 1)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vagues</label>
            <input
              type="number"
              min="1"
              max="20"
              value={config.waves}
              onChange={(e) => handleConfigChange('waves', parseInt(e.target.value) || 15)}
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Juges - Boutons 3 ou 5 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">Nombre de juges</label>
          <div className="flex space-x-3 mb-4">
            <button
              onClick={() => setJudgeCount(3)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.judges.length === 3
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              3 Juges
            </button>
            <button
              onClick={() => setJudgeCount(5)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.judges.length === 5
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              5 Juges
            </button>
          </div>
          
          {/* Noms des juges */}
          <div className="space-y-2">
            {config.judges.map((judgeId) => (
              <div key={judgeId} className="flex items-center space-x-2">
                <div className="w-12 px-2 py-1 text-xs bg-gray-100 border border-gray-300 rounded text-center font-medium">
                  {judgeId}
                </div>
                <input
                  type="text"
                  value={config.judgeNames[judgeId] || ''}
                  onChange={(e) => handleJudgeNameChange(judgeId, e.target.value)}
                  placeholder="Nom du juge"
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Surfeurs - Boutons pour choisir le nombre */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">Nombre de surfeurs</label>
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={() => setSurferCount(2)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.surfers.length === 2
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              Man on Man (2)
            </button>
            <button
              onClick={() => setSurferCount(4)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.surfers.length === 4
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              4 Surfeurs
            </button>
            <button
              onClick={() => setSurferCount(5)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.surfers.length === 5
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              5 Surfeurs
            </button>
            <button
              onClick={() => setSurferCount(6)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                config.surfers.length === 6
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
            >
              6 Surfeurs
            </button>
          </div>
          
          {/* Affichage des surfeurs avec couleurs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {config.surfers.map((surfer, index) => (
              <div key={index} className="flex items-center space-x-2 p-2 bg-gray-50 rounded">
                <div
                  className="w-4 h-4 rounded-full border border-gray-300"
                  style={{ 
                    backgroundColor: surfer === 'ROUGE' ? '#ef4444' :
                                   surfer === 'BLANC' ? '#f8fafc' :
                                   surfer === 'JAUNE' ? '#eab308' :
                                   surfer === 'BLEU' ? '#3b82f6' :
                                   surfer === 'VERT' ? '#22c55e' :
                                   surfer === 'NOIR' ? '#1f2937' : '#6b7280'
                  }}
                />
                <span className="text-sm font-medium text-gray-900">{surfer}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={handleSaveConfig}
          className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition-colors font-medium text-lg"
        >
          {configSaved ? '✅ Configuration Sauvegardée' : 'Sauvegarder la Configuration'}
        </button>
      </div>

      {/* Timer */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Clock className="w-6 h-6 text-green-600" />
          <h2 className="text-xl font-semibold text-gray-900">Timer du Heat</h2>
        </div>
        <HeatTimer 
          timer={timer} 
          onStart={handleTimerStart}
          onPause={handleTimerPause}
          onReset={handleTimerReset}
          onDurationChange={handleTimerDurationChange}
          configSaved={configSaved}
        />
      </div>

      {/* Close Heat */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Gestion du Heat</h2>
                <p className="text-sm text-gray-600">
                  Heat actuel: {config.competition} - {config.division} - R{config.round} H{config.heatId}
                </p>
              </div>
            </div>
            
            <button
              onClick={handleCloseHeat}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium transition-colors"
            >
              <CheckCircle className="w-5 h-5" />
              <span>Fermer le Heat</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          
          {/* Statistiques des juges */}
          {Object.keys(judgeWorkCount).length > 0 && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Heats consécutifs par juge:</h3>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(judgeWorkCount).map(([judgeId, count]) => (
                  <div key={judgeId} className={`flex items-center justify-between p-2 rounded ${
                    count >= 4 ? 'bg-red-100 text-red-800' : 
                    count >= 3 ? 'bg-orange-100 text-orange-800' : 
                    'bg-green-100 text-green-800'
                  }`}>
                    <span className="text-sm font-medium">
                      {config.judgeNames[judgeId] || judgeId}
                    </span>
                    <span className="text-sm font-bold">{count}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                🟢 Normal • 🟠 Attention (3+) • 🔴 Fatigue (4+)
              </p>
            </div>
          )}
        </div>
      )}

      {/* Paramètres avancés */}
      <div className="bg-white rounded-lg shadow p-6">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-gray-600" />
            <h3 className="text-lg font-medium text-gray-900">Paramètres avancés</h3>
          </div>
          <span className="text-gray-400">{showAdvanced ? '−' : '+'}</span>
        </button>

        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <div className="flex space-x-3">
              <button
                onClick={onReloadData}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Recharger</span>
              </button>
              
              <button
                onClick={handleResetAllData}
                className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-bold"
              >
                <Trash2 className="w-4 h-4" />
                <span>🚀 RESET NUCLÉAIRE</span>
              </button>
              
              <button
                onClick={exportData}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                <Download className="w-4 h-4" />
                <span>Export</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Liens pour les juges */}
      {configSaved && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center space-x-3 mb-4">
            <Users className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-semibold text-gray-900">Liens pour les Juges</h2>
          </div>
          
          <div className="space-y-3">
            {generateJudgeLinks().map(({ judgeId, judgeName, url, uniqueCode, heatId }) => (
              <div key={judgeId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900">{judgeName}</span>
                  <span className="text-sm text-gray-500 ml-2">({judgeId})</span>
                  <div className="text-xs text-gray-400 mt-1">
                    Heat: {heatId} • Code: {uniqueCode}
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={url}
                    readOnly
                    className="w-96 px-2 py-1 text-xs bg-white border border-gray-300 rounded font-mono"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(url)}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Copier
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Tester
                  </a>
                </div>
              </div>
            ))}
            
            <div className="mt-4 p-3 bg-blue-50 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>📱 Instructions WhatsApp :</strong><br/>
                1. Copiez le lien complet<br/>
                2. Envoyez via WhatsApp<br/>
                3. Le juge clique → connexion automatique avec toute la config !<br/>
                <strong>🔒 Sécurité :</strong> Chaque lien est unique à ce heat spécifique.<br/>
                <strong>⚠️ Important :</strong> Les liens changent à chaque nouveau heat.<br/>
                <strong>✅ Continuité :</strong> Les juges restent connectés lors du passage au heat suivant.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminInterface;