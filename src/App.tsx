import React, { useState, useEffect } from 'react';
import { Settings, User, Monitor, Waves, AlertTriangle } from 'lucide-react';
import AdminInterface from './components/AdminInterface';
import JudgeInterface from './components/JudgeInterface';
import JudgeLogin from './components/JudgeLogin';
import ScoreDisplay from './components/ScoreDisplay';
import SyncStatus from './components/SyncStatus';
import { useSupabaseSync } from './hooks/useSupabaseSync';
import { useRealtimeSync } from './hooks/useRealtimeSync';
import { DEFAULT_TIMER_DURATION } from './utils/constants';
import type { AppConfig, Score, HeatTimer } from './types';

function App() {
  // États principaux
  const [currentView, setCurrentView] = useState<'admin' | 'judge' | 'display'>('admin');
  const [config, setConfig] = useState<AppConfig>({
    competition: '',
    division: '',
    round: 1,
    heatId: 1,
    judges: ['J1', 'J2', 'J3'],
    surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
    waves: 15,
    judgeNames: {},
    tournamentType: 'elimination',
    totalSurfers: 32,
    surfersPerHeat: 4,
    totalHeats: 8,
    totalRounds: 4
  });
  
  const [configSaved, setConfigSaved] = useState(false);
  const [scores, setScores] = useState<Score[]>([]);
  const [currentJudge, setCurrentJudge] = useState<{ id: string; name: string } | null>(null);
  const [judgeWorkCount, setJudgeWorkCount] = useState<Record<string, number>>({});
  
  // Timer state
  const [timer, setTimer] = useState<HeatTimer>({
    isRunning: false,
    startTime: null,
    duration: DEFAULT_TIMER_DURATION
  });

  // Hooks
  const { 
    syncStatus, 
    saveScore, 
    createHeat, 
    updateHeatStatus,
    loadScoresFromDatabase,
    syncPendingScores,
    saveHeatConfig,
    saveTimerState,
    loadHeatConfig,
    loadTimerState
  } = useSupabaseSync();

  const {
    isConnected: realtimeConnected,
    lastUpdate: realtimeLastUpdate,
    error: realtimeError,
    publishTimerStart,
    publishTimerPause,
    publishTimerReset,
    publishConfigUpdate,
    subscribeToHeat
  } = useRealtimeSync();

  // Vérifier les paramètres URL au chargement
  useEffect(() => {
    console.log('🔍 Vérification des paramètres URL...');
    const urlParams = new URLSearchParams(window.location.search);
    console.log('📋 Paramètres URL détectés:', Object.fromEntries(urlParams.entries()));
    
    // Debug: Afficher l'URL complète
    console.log('🌐 URL complète:', window.location.href);
    console.log('🌐 Hostname:', window.location.hostname);
    console.log('🌐 Origin:', window.location.origin);
    
    // Vérifier le paramètre view pour définir la vue par défaut
    const viewParam = urlParams.get('view');
    if (viewParam && ['admin', 'judge', 'display'].includes(viewParam)) {
      setCurrentView(viewParam as 'admin' | 'judge' | 'display');
      console.log('🎯 Vue définie depuis URL:', viewParam);
    }
    
    // Vérifier les paramètres URL pour auto-connexion juge EN PREMIER
    const judgeParam = urlParams.get('judge');
    const heatParam = urlParams.get('heat');
    const configParam = urlParams.get('config');

    console.log('🔗 Paramètres détectés:', { judgeParam, heatParam, configParam: configParam ? 'présent' : 'absent' });

    if (judgeParam && heatParam && configParam) {
      try {
        console.log('🔄 Décodage de la configuration depuis URL...');
        const decodedConfig = JSON.parse(atob(configParam));
        console.log('✅ Configuration décodée:', decodedConfig);
        
        // Appliquer la configuration
        setConfig(decodedConfig);
        setConfigSaved(true);
        
        // Connecter automatiquement le juge
        const judgeName = decodedConfig.judgeNames[judgeParam] || judgeParam;
        setCurrentJudge({ id: judgeParam, name: judgeName });
        setCurrentView('judge');
        
        console.log('🎯 Juge connecté automatiquement:', { id: judgeParam, name: judgeName });
        console.log('🎯 Vue définie sur: judge');
        
        // Sauvegarder dans localStorage pour persistance
        localStorage.setItem('surfJudgingConfig', JSON.stringify(decodedConfig));
        localStorage.setItem('surfJudgingConfigSaved', 'true');
        localStorage.setItem('surfJudgingCurrentJudge', JSON.stringify({ id: judgeParam, name: judgeName }));
        
      } catch (error) {
        console.error('❌ Erreur décodage config URL:', error);
      }
    }
  }, []);

  // Charger les données depuis localStorage au démarrage
  useEffect(() => {
    console.log('🔄 Chargement des données depuis localStorage...');
    
    // Charger la configuration
    const savedConfig = localStorage.getItem('surfJudgingConfig');
    const savedConfigSaved = localStorage.getItem('surfJudgingConfigSaved');
    const savedCurrentJudge = localStorage.getItem('surfJudgingCurrentJudge');
    const savedTimer = localStorage.getItem('surfJudgingTimer');
    const savedScores = localStorage.getItem('surfJudgingScores');
    const savedJudgeWorkCount = localStorage.getItem('surfJudgingJudgeWorkCount');

    if (savedConfig) {
      try {
        const parsedConfig = JSON.parse(savedConfig);
        setConfig(parsedConfig);
        console.log('✅ Configuration chargée:', parsedConfig);
      } catch (error) {
        console.error('❌ Erreur chargement config:', error);
      }
    }

    if (savedConfigSaved === 'true') {
      setConfigSaved(true);
      console.log('✅ Configuration marquée comme sauvée');
    }

    if (savedCurrentJudge) {
      try {
        const parsedJudge = JSON.parse(savedCurrentJudge);
        setCurrentJudge(parsedJudge);
        console.log('✅ Juge courant chargé:', parsedJudge);
      } catch (error) {
        console.error('❌ Erreur chargement juge:', error);
      }
    }

    if (savedTimer) {
      try {
        const parsedTimer = JSON.parse(savedTimer);
        if (parsedTimer.startTime && typeof parsedTimer.startTime === 'string') {
          parsedTimer.startTime = new Date(parsedTimer.startTime);
        }
        setTimer(parsedTimer);
        console.log('✅ Timer chargé:', parsedTimer);
      } catch (error) {
        console.error('❌ Erreur chargement timer:', error);
      }
    }

    if (savedScores) {
      try {
        const parsedScores = JSON.parse(savedScores);
        setScores(parsedScores);
        console.log('✅ Scores chargés:', parsedScores.length);
      } catch (error) {
        console.error('❌ Erreur chargement scores:', error);
      }
    }

    if (savedJudgeWorkCount) {
      try {
        const parsedWorkCount = JSON.parse(savedJudgeWorkCount);
        setJudgeWorkCount(parsedWorkCount);
        console.log('✅ Compteur travail juges chargé:', parsedWorkCount);
      } catch (error) {
        console.error('❌ Erreur chargement compteur juges:', error);
      }
    }
  }, []);

  // Subscription temps réel
  useEffect(() => {
    if (!configSaved || !config.competition) return;

    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    console.log('🔔 Subscription temps réel pour heat:', heatId);

    const unsubscribe = subscribeToHeat(heatId, (newTimer, newConfig) => {
      console.log('📡 Mise à jour temps réel reçue:', { newTimer, newConfig });
      
      if (newTimer) {
        setTimer(newTimer);
        localStorage.setItem('surfJudgingTimer', JSON.stringify(newTimer));
      }
      
      if (newConfig) {
        setConfig(newConfig);
        localStorage.setItem('surfJudgingConfig', JSON.stringify(newConfig));
      }
    });

    return unsubscribe;
  }, [configSaved, config.competition, config.division, config.round, config.heatId, subscribeToHeat]);

  // Gestionnaires d'événements
  const handleConfigChange = (newConfig: AppConfig) => {
    setConfig(newConfig);
  };

  const handleConfigSaved = async (saved: boolean) => {
    setConfigSaved(saved);
    localStorage.setItem('surfJudgingConfigSaved', saved.toString());
    
    if (saved) {
      // Créer le heat dans Supabase
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
      
      try {
        await createHeat({
          competition: config.competition,
          division: config.division,
          round: config.round,
          heat_number: config.heatId,
          status: 'open'
        });

        // Sauvegarder la config du heat
        await saveHeatConfig(heatId, config);
        
        // Publier la config en temps réel
        await publishConfigUpdate(heatId, config);
        
        console.log('✅ Heat créé et config publiée:', heatId);
      } catch (error) {
        console.log('⚠️ Heat créé en mode local uniquement');
      }
    }
  };

  const handleScoreSubmit = async (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    try {
      const newScore = await saveScore(scoreData, heatId);
      
      // Mettre à jour les scores locaux
      setScores(prev => [...prev, newScore]);
      
      console.log('✅ Score sauvé:', newScore);
    } catch (error) {
      console.error('❌ Erreur sauvegarde score:', error);
    }
  };

  const handleJudgeLogin = (judgeId: string, judgeName: string) => {
    const judge = { id: judgeId, name: judgeName };
    setCurrentJudge(judge);
    localStorage.setItem('surfJudgingCurrentJudge', JSON.stringify(judge));
    console.log('👤 Juge connecté:', judge);
  };

  const handleJudgeLogout = () => {
    setCurrentJudge(null);
    localStorage.removeItem('surfJudgingCurrentJudge');
    console.log('👤 Juge déconnecté');
  };

  const handleTimerChange = (newTimer: HeatTimer) => {
    setTimer(newTimer);
  };

  const handleReloadData = () => {
    window.location.reload();
  };

  const handleResetAllData = () => {
    console.log('🗑️ RESET COMPLET DE TOUTES LES DONNÉES...');
    
    // Vider localStorage
    localStorage.clear();
    sessionStorage.clear();
    
    // Reset des états
    setConfig({
      competition: '',
      division: '',
      round: 1,
      heatId: 1,
      judges: ['J1', 'J2', 'J3'],
      surfers: ['ROUGE', 'BLANC', 'JAUNE', 'BLEU'],
      waves: 15,
      judgeNames: {},
      tournamentType: 'elimination',
      totalSurfers: 32,
      surfersPerHeat: 4,
      totalHeats: 8,
      totalRounds: 4
    });
    setConfigSaved(false);
    setScores([]);
    setCurrentJudge(null);
    setJudgeWorkCount({});
    setTimer({
      isRunning: false,
      startTime: null,
      duration: DEFAULT_TIMER_DURATION
    });
    
    console.log('✅ Reset complet terminé');
  };

  const handleCloseHeat = async () => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    
    try {
      // Fermer le heat dans Supabase
      await updateHeatStatus(heatId, 'closed', new Date().toISOString());
      console.log('✅ Heat fermé:', heatId);
    } catch (error) {
      console.log('⚠️ Heat fermé en mode local uniquement');
    }
    
    // Incrémenter le compteur de travail des juges
    const newWorkCount = { ...judgeWorkCount };
    config.judges.forEach(judgeId => {
      newWorkCount[judgeId] = (newWorkCount[judgeId] || 0) + 1;
    });
    setJudgeWorkCount(newWorkCount);
    localStorage.setItem('surfJudgingJudgeWorkCount', JSON.stringify(newWorkCount));
    
    // Passer au heat suivant
    const nextHeatId = config.heatId + 1;
    const newConfig = { ...config, heatId: nextHeatId };
    setConfig(newConfig);
    localStorage.setItem('surfJudgingConfig', JSON.stringify(newConfig));
    
    // Reset du timer
    const resetTimer = {
      isRunning: false,
      startTime: null,
      duration: DEFAULT_TIMER_DURATION
    };
    setTimer(resetTimer);
    localStorage.setItem('surfJudgingTimer', JSON.stringify(resetTimer));
    
    // Vider les scores pour le nouveau heat
    setScores([]);
    localStorage.setItem('surfJudgingScores', JSON.stringify([]));
    
    console.log(`🏁 Heat ${config.heatId} fermé, passage au heat ${nextHeatId}`);
  };

  const openTabInNewWindow = (view: 'admin' | 'judge' | 'display') => {
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('view', view);
    window.open(currentUrl.toString(), '_blank');
  };

  // Rendu conditionnel basé sur la vue
  const renderCurrentView = () => {
    switch (currentView) {
      case 'admin':
        return (
          <AdminInterface
            config={config}
            onConfigChange={handleConfigChange}
            onConfigSaved={handleConfigSaved}
            configSaved={configSaved}
            timer={timer}
            onTimerChange={handleTimerChange}
            onReloadData={handleReloadData}
            onResetAllData={handleResetAllData}
            onCloseHeat={handleCloseHeat}
            judgeWorkCount={judgeWorkCount}
            onRealtimeTimerStart={publishTimerStart}
            onRealtimeTimerPause={publishTimerPause}
            onRealtimeTimerReset={publishTimerReset}
          />
        );

      case 'judge':
        if (!currentJudge) {
          return (
            <JudgeLogin
              onLogin={handleJudgeLogin}
              availableJudges={config.judges.map(id => ({
                id,
                name: config.judgeNames[id] || id
              }))}
            />
          );
        }
        return (
          <div>
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <div className="flex items-center space-x-3">
                <User className="w-5 h-5 text-blue-600" />
                <span className="font-medium">Connecté: {currentJudge.name}</span>
              </div>
              <button
                onClick={handleJudgeLogout}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
              >
                Déconnexion
              </button>
            </div>
            <JudgeInterface
              config={config}
              judgeId={currentJudge.id}
              onScoreSubmit={handleScoreSubmit}
              configSaved={configSaved}
              timer={timer}
            />
          </div>
        );

      case 'display':
        return (
          <ScoreDisplay
            config={config}
            scores={scores}
            timer={timer}
            configSaved={configSaved}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* NAVIGATION */}
      <nav className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Waves className="w-8 h-8 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900">Surf Judging System</h1>
            </div>

            <div className="flex space-x-1">
              <button
                onClick={() => openTabInNewWindow('admin')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                  currentView === 'admin'
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Settings className="w-4 h-4" />
                <span>Administration</span>
              </button>

              <button
                onClick={() => openTabInNewWindow('judge')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                  currentView === 'judge'
                    ? 'bg-green-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Interface Juge</span>
              </button>

              <button
                onClick={() => openTabInNewWindow('display')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2 ${
                  currentView === 'display'
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Monitor className="w-4 h-4" />
                <span>Affichage Public</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* STATUT DE SYNCHRONISATION */}
      <div className="max-w-7xl mx-auto px-4 py-2">
        <SyncStatus
          isOnline={syncStatus.isOnline}
          lastSync={syncStatus.lastSync}
          pendingScores={syncStatus.pendingScores}
          syncError={syncStatus.syncError}
          onManualSync={syncPendingScores}
          realtimeConnected={realtimeConnected}
          realtimeLastUpdate={realtimeLastUpdate}
        />
      </div>

      {/* CONTENU PRINCIPAL */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {renderCurrentView()}
      </main>

      {/* ERREURS TEMPS RÉEL */}
      {realtimeError && (
        <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded max-w-md">
          <div className="flex items-center">
            <AlertTriangle className="w-5 h-5 mr-2" />
            <div>
              <strong>Erreur temps réel:</strong>
              <p className="text-sm">{realtimeError}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;