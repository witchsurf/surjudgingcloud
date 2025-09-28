import React, { useState, useEffect } from 'react';
import { Trophy, Medal, Award, Waves, Clock, Users, TrendingUp, Eye, Target } from 'lucide-react';
import { calculateSurferStats } from '../utils/scoring';
import { SURFER_COLORS } from '../utils/constants';
import { useSupabaseSync } from '../hooks/useSupabaseSync';
import type { AppConfig, Score, SurferStats } from '../types';
import HeatTimer from './HeatTimer';

interface ScoreDisplayProps {
  config: AppConfig;
  scores: Score[];
  timer: any;
  configSaved: boolean;
}

function ScoreDisplay({ config, scores, timer, configSaved }: ScoreDisplayProps) {
  const [surferStats, setSurferStats] = useState<SurferStats[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [realTimeScores, setRealTimeScores] = useState<Score[]>(scores);
  const [currentHeatId, setCurrentHeatId] = useState<string>('');
  
  // Hook pour charger les scores depuis Supabase
  const { loadScoresFromDatabase } = useSupabaseSync();

  // Générer l'ID du heat actuel
  useEffect(() => {
    const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
    setCurrentHeatId(heatId);
  }, [config.competition, config.division, config.round, config.heatId]);

  // Écouter les changements de scores depuis localStorage en temps réel pour le heat actuel uniquement
  useEffect(() => {
    if (!currentHeatId) return;
    
    // Fonction pour mettre à jour les scores depuis localStorage
    const handleStorageChange = () => {
      const savedScores = localStorage.getItem('surfJudgingScores');
      if (savedScores) {
        try {
          const parsedScores = JSON.parse(savedScores);
          // Filtrer par heat ID
          const heatScores = parsedScores.filter((s: Score) => s.heat_id === currentHeatId);
          console.log('📊 AFFICHAGE: Scores mis à jour depuis localStorage pour heat', currentHeatId, ':', heatScores.length);
          setRealTimeScores(heatScores);
          setLastUpdate(new Date());
        } catch (error) {
          console.error('Erreur parsing scores localStorage:', error);
        }
      }
    };

    // Fonction pour gérer les nouveaux scores
    const handleScoreUpdate = (e: CustomEvent) => {
      console.log('📊 AFFICHAGE: Nouveau score reçu:', e.detail);
      handleStorageChange(); // Recharger depuis localStorage
    };

    // Écouter les changements de localStorage
    window.addEventListener('storage', handleStorageChange);
    
    // Écouter les événements personnalisés pour les mises à jour immédiates
    window.addEventListener('scoreUpdate', handleScoreUpdate as EventListener);
    
    // Charger immédiatement les scores
    handleStorageChange();
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('scoreUpdate', handleScoreUpdate as EventListener);
    };
  }, [currentHeatId]);

  // Écouter les changements de scores en temps réel
  useEffect(() => {
    // Écouter les nouveaux scores depuis Supabase en temps réel
    const handleNewScoreRealtime = (e: CustomEvent) => {
      const newScore = e.detail;
      console.log('📊 AFFICHAGE: Nouveau score temps réel reçu:', newScore);
      
      // Ajouter le nouveau score aux scores existants
      setRealTimeScores(prev => {
        const exists = prev.find(s => s.id === newScore.id);
        if (exists) return prev;
        
        const formattedScore = {
          id: newScore.id,
          heat_id: newScore.heat_id,
          competition: newScore.competition,
          division: newScore.division,
          round: newScore.round,
          judge_id: newScore.judge_id,
          judge_name: newScore.judge_name,
          surfer: newScore.surfer,
          wave_number: newScore.wave_number,
          score: parseFloat(newScore.score),
          timestamp: newScore.timestamp,
          created_at: newScore.created_at,
          synced: true
        };
        
        return [...prev, formattedScore];
      });
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'surfJudgingScores' && e.newValue) {
        try {
          const parsedScores = JSON.parse(e.newValue);
          setRealTimeScores(parsedScores);
          console.log('📊 Affichage: Scores mis à jour en temps réel:', parsedScores.length);
        } catch (error) {
          console.error('Erreur sync scores affichage:', error);
        }
      }
    };

    window.addEventListener('newScoreRealtime', handleNewScoreRealtime as EventListener);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('newScoreRealtime', handleNewScoreRealtime as EventListener);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Mettre à jour les scores locaux
  useEffect(() => {
    setRealTimeScores(scores);
  }, [scores]);

  // Charger les scores depuis Supabase au démarrage
  useEffect(() => {
    const loadScoresFromSupabase = async () => {
      if (configSaved && config.competition && config.division && config.round && config.heatId) {
        const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
        console.log('📊 AFFICHAGE: Chargement scores depuis Supabase pour heat:', heatId);
        
        try {
          const dbScores = await loadScoresFromDatabase(heatId);
          if (dbScores && dbScores.length > 0) {
            // Convertir les scores de la DB au format local
            const formattedScores = dbScores.map(score => ({
              id: score.id,
              heat_id: score.heat_id,
              competition: score.competition,
              division: score.division,
              round: score.round,
              judge_id: score.judge_id,
              judge_name: score.judge_name,
              surfer: score.surfer,
              wave_number: score.wave_number,
              score: parseFloat(score.score.toString()),
              timestamp: score.timestamp,
              created_at: score.created_at,
              synced: true
            }));
            
            console.log('📊 AFFICHAGE: Scores chargés depuis Supabase:', formattedScores.length);
            setRealTimeScores(formattedScores);
          } else {
            console.log('📊 AFFICHAGE: Aucun score trouvé dans Supabase');
          }
        } catch (error) {
          console.log('⚠️ AFFICHAGE: Erreur chargement scores Supabase, utilisation cache local');
        }
      }
    };

    loadScoresFromSupabase();
  }, [configSaved, config.competition, config.division, config.round, config.heatId, loadScoresFromDatabase]);

  // Recharger les scores périodiquement
  useEffect(() => {
    if (!configSaved || !config.competition) return;

    const interval = setInterval(async () => {
      const heatId = `${config.competition}_${config.division}_R${config.round}_H${config.heatId}`;
      console.log('🔄 AFFICHAGE: Rechargement périodique des scores...');
      
      try {
        const dbScores = await loadScoresFromDatabase(heatId);
        if (dbScores && dbScores.length > 0) {
          const formattedScores = dbScores.map(score => ({
            id: score.id,
            heat_id: score.heat_id,
            competition: score.competition,
            division: score.division,
            round: score.round,
            judge_id: score.judge_id,
            judge_name: score.judge_name,
            surfer: score.surfer,
            wave_number: score.wave_number,
            score: parseFloat(score.score.toString()),
            timestamp: score.timestamp,
            created_at: score.created_at,
            synced: true
          }));
          
          // Mettre à jour seulement si on a de nouveaux scores
          if (formattedScores.length !== realTimeScores.length) {
            console.log('📊 AFFICHAGE: Nouveaux scores détectés:', formattedScores.length);
            setRealTimeScores(formattedScores);
          }
        }
      } catch (error) {
        console.log('⚠️ AFFICHAGE: Erreur rechargement périodique');
      }
    }, 5000); // Recharger toutes les 5 secondes

    return () => clearInterval(interval);
  }, [configSaved, config.competition, config.division, config.round, config.heatId, loadScoresFromDatabase, realTimeScores.length]);

  useEffect(() => {
    if (!configSaved) return;

    // Calculer les statistiques avec le nouveau système
    const stats = calculateSurferStats(realTimeScores, config.surfers, config.judges.length, config.waves);
    console.log('📊 AFFICHAGE: Stats calculées:', stats);
    setSurferStats(stats);
    setLastUpdate(new Date());
  }, [realTimeScores, config, configSaved]);

  // Calculer le score nécessaire pour que le 2ème devienne 1er
  const calculateNeededScore = () => {
    if (surferStats.length < 2) return null;
    
    const first = surferStats.find(s => s.rank === 1);
    const second = surferStats.find(s => s.rank === 2);
    
    if (!first || !second) return null;
    
    // Trouver la meilleure note actuelle du 2ème
    const secondBestScore = second.waves.filter(w => w.isComplete).length > 0 
      ? Math.max(...second.waves.filter(w => w.isComplete).map(w => w.score))
      : 0;
    
    // Calculer le score nécessaire : total du 1er - meilleure note du 2ème + 0.1
    const neededScore = first.bestTwo - secondBestScore + 0.1;
    
    return {
      surfer: second.surfer,
      currentBest: secondBestScore,
      neededScore: Math.min(neededScore, 10), // Max 10
      difference: neededScore
    };
  };

  const neededScoreInfo = calculateNeededScore();

  // Calculer les scores nécessaires pour tous les surfeurs
  const calculateAllNeededScores = () => {
    const results: Record<string, { neededScore: number; targetPosition: number }> = {};
    
    // Pour chaque surfeur, calculer ce qu'il faut pour se qualifier (dépasser le 2ème)
    surferStats.forEach((surfer, index) => {
      if (surfer.rank > 2) {
        // Pour les 3ème et 4ème, ils doivent dépasser le 2ème pour se qualifier
        const targetSurfer = surferStats.find(s => s.rank === 2);
        if (targetSurfer) {
          // Trouver la meilleure note actuelle du surfeur
          const currentBestScore = surfer.waves.filter(w => w.isComplete).length > 0 
            ? Math.max(...surfer.waves.filter(w => w.isComplete).map(w => w.score))
            : 0;
          
          // Score nécessaire = total du 2ème - meilleure note actuelle + 0.01
          const neededScore = targetSurfer.bestTwo - currentBestScore + 0.01;
          
          results[surfer.surfer] = {
            neededScore: Math.min(neededScore, 10), // Max 10
            targetPosition: 2 // Viser la qualification (2ème place)
          };
        }
      } else if (surfer.rank === 2) {
        // Le 2ème veut dépasser le 1er
        const targetSurfer = surferStats.find(s => s.rank === 1);
        if (targetSurfer) {
          const currentBestScore = surfer.waves.filter(w => w.isComplete).length > 0 
            ? Math.max(...surfer.waves.filter(w => w.isComplete).map(w => w.score))
            : 0;
          
          const neededScore = targetSurfer.bestTwo - currentBestScore + 0.01;
          
          results[surfer.surfer] = {
            neededScore: Math.min(neededScore, 10),
            targetPosition: 1
          };
        }
      }
    });
    
    return results;
  };

  const allNeededScores = calculateAllNeededScores();
  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1: return <Trophy className="w-6 h-6 text-yellow-500" />;
      case 2: return <Medal className="w-6 h-6 text-gray-400" />;
      case 3: return <Award className="w-6 h-6 text-amber-600" />;
      default: return <div className="w-6 h-6 flex items-center justify-center text-gray-500 font-bold">{rank}</div>;
    }
  };

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1: return 'bg-gradient-to-r from-yellow-400 to-yellow-500 text-white';
      case 2: return 'bg-gradient-to-r from-gray-300 to-gray-400 text-white';
      case 3: return 'bg-gradient-to-r from-amber-500 to-amber-600 text-white';
      default: return 'bg-white border border-gray-200';
    }
  };

  if (!configSaved) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
          <Waves className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-blue-800 mb-2">En attente de configuration</h2>
          <p className="text-blue-700">
            L'affichage des scores sera disponible une fois la compétition configurée.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* HEADER COMPÉTITION */}
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">{config.competition}</h1>
            <div className="flex items-center space-x-4 text-blue-100">
              <span className="flex items-center">
                <Users className="w-4 h-4 mr-1" />
                {config.division}
              </span>
              <span>Round {config.round}</span>
              <span>Heat {config.heatId}</span>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-sm text-blue-100 mb-1">Dernière mise à jour</div>
            <div className="font-mono">{lastUpdate.toLocaleTimeString('fr-FR')}</div>
          </div>
        </div>
      </div>

      {/* TIMER */}
      <div className="flex justify-center">
        <HeatTimer
          timer={timer}
          onStart={() => {}}
          onPause={() => {}}
          onReset={() => {}}
          onDurationChange={() => {}}
          showControls={false}
          size="large"
          configSaved={configSaved}
        />
      </div>

      {/* CLASSEMENT */}
      <div className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900 flex items-center">
              <Trophy className="w-6 h-6 mr-2 text-yellow-500" />
              Classement en temps réel
            </h2>
          </div>

          <div className="divide-y divide-gray-200">
            {surferStats
              .sort((a, b) => a.rank - b.rank)
              .map((surferStat, index) => (
                <div
                  key={surferStat.surfer}
                  className={`p-6 transition-all duration-300 ${getRankColor(surferStat.rank)} ${
                    index === 0 ? 'animate-pulse' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {/* RANG ET SURFEUR */}
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center justify-center w-12 h-12">
                        {getRankIcon(surferStat.rank)}
                      </div>
                      
                      <div className="flex items-center space-x-3">
                        <div
                          className="w-6 h-6 rounded-full border-2 border-white shadow-sm"
                          style={{ backgroundColor: surferStat.color }}
                        />
                        <div>
                          <div className="text-xl font-bold">{surferStat.surfer}</div>
                          <div className={`text-sm ${surferStat.rank <= 3 ? 'text-white/80' : 'text-gray-500'}`}>
                            {surferStat.waves.filter(w => w.isComplete).length} vague{surferStat.waves.filter(w => w.isComplete).length > 1 ? 's' : ''} complète{surferStat.waves.filter(w => w.isComplete).length > 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* SCORES */}
                    <div className="flex items-center space-x-6">
                      {/* SCORES INDIVIDUELS */}
                      <div className="flex space-x-2">
                        {surferStat.waves
                          .filter(w => w.isComplete)
                          .sort((a, b) => b.score - a.score)
                          .slice(0, 5)
                          .map((wave, idx) => (
                            <div
                              key={idx}
                              className={`px-3 py-1 rounded-lg text-sm font-medium ${
                                idx < 2 
                                  ? surferStat.rank <= 3 
                                    ? 'bg-white/20 text-white' 
                                    : 'bg-blue-100 text-blue-800'
                                  : surferStat.rank <= 3
                                    ? 'bg-white/10 text-white/70'
                                    : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {wave.score.toFixed(2)}
                            </div>
                          ))}
                      </div>

                      {/* TOTAL BEST 2 */}
                      <div className="text-right">
                        <div className={`text-3xl font-bold ${surferStat.rank <= 3 ? 'text-white' : 'text-gray-900'} flex items-center justify-end space-x-3`}>
                          <span>
                            {surferStat.bestTwo.toFixed(2)}
                          </span>
                          {/* Afficher WIN BY pour le 1er à côté */}
                          {surferStat.rank === 1 && surferStats.length >= 2 && (
                            <span className={`text-lg font-medium ${surferStat.rank <= 3 ? 'text-white/80' : 'text-green-600'}`}>
                              WIN BY {(surferStat.bestTwo - surferStats.find(s => s.rank === 2)!.bestTwo).toFixed(2)}
                            </span>
                          )}
                          {/* Afficher NEED pour tous les autres surfeurs */}
                          {allNeededScores[surferStat.surfer] && (
                            <span className={`text-lg font-medium ${surferStat.rank <= 3 ? 'text-white/80' : 'text-orange-600'}`}>
                              NEED {allNeededScores[surferStat.surfer].neededScore.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <div className={`text-sm ${surferStat.rank <= 3 ? 'text-white/80' : 'text-gray-500'}`}>
                          {surferStat.waves.filter(w => w.isComplete).length} vagues
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* STATISTIQUES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Scores</p>
              <p className="text-2xl font-bold text-gray-900">{scores.length}</p>
            </div>
            <Waves className="w-8 h-8 text-blue-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Juges Actifs</p>
              <p className="text-2xl font-bold text-gray-900">{config.judges.length}</p>
            </div>
            <Users className="w-8 h-8 text-green-500" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Surfeurs</p>
              <p className="text-2xl font-bold text-gray-900">{config.surfers.length}</p>
            </div>
            <Trophy className="w-8 h-8 text-yellow-500" />
          </div>
        </div>
      </div>

      {/* DÉTAIL DES VAGUES PAR SURFEUR */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <TrendingUp className="w-6 h-6 mr-2 text-blue-600" />
            Détail des vagues
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Surfeur</th>
                {Array.from({ length: Math.max(...surferStats.map(s => s.waves.length), 1) }, (_, i) => i + 1).map(wave => (
                  <th key={wave} className="px-3 py-3 text-center text-sm font-semibold text-gray-900">
                    V{wave}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-sm font-semibold text-gray-900 bg-green-50">Best 2</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {surferStats
                .sort((a, b) => a.rank - b.rank)
                .map((surferStat, index) => (
                  <tr key={surferStat.surfer} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-3">
                      <div className="flex items-center space-x-3">
                        <div className="flex items-center justify-center w-6 h-6 text-sm font-bold text-white rounded-full bg-gray-600">
                          {surferStat.rank}
                        </div>
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: surferStat.color }}
                        />
                        <span className="font-semibold text-gray-900">{surferStat.surfer}</span>
                      </div>
                    </td>
                    {Array.from({ length: Math.max(...surferStats.map(s => s.waves.length), 1) }, (_, i) => i + 1).map(waveNum => {
                      const wave = surferStat.waves.find(w => w.wave === waveNum);
                      return (
                        <td key={waveNum} className="px-3 py-3 text-center">
                          {wave && wave.score > 0 ? (
                            <div className="relative group">
                              <span className={`inline-block px-2 py-1 rounded text-sm font-medium cursor-help ${
                                wave.isComplete 
                                  ? 'bg-blue-100 text-blue-800' 
                                  : 'bg-orange-100 text-orange-800 border border-orange-300'
                              }`}>
                                {wave.score.toFixed(2)}
                                {!wave.isComplete && (
                                  <span className="ml-1 text-xs">*</span>
                                )}
                              </span>
                              
                              {/* Tooltip avec détail des scores par juge */}
                              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 min-w-max">
                                {Object.entries(wave.judgeScores)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([judgeId, score], index, array) => (
                                    <span key={judgeId}>
                                      {judgeId}={score.toFixed(1)}{index < array.length - 1 ? ', ' : ''}
                                    </span>
                                  ))}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-center bg-green-50">
                      <span className="font-bold text-green-900 text-lg">
                        {surferStat.bestTwo.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
          
        {/* Légende */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">8.50</span>
              <span className="text-gray-600">Score complet (tous les juges)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 bg-orange-100 text-orange-800 border border-orange-300 rounded text-xs">7.25*</span>
              <span className="text-gray-600">Notation en cours</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 border-2 border-dashed border-orange-300 text-orange-700 bg-orange-50 rounded text-xs">6.50*</span>
              <span className="text-gray-600">Score partiel affiché</span>
            </div>
            <div className="flex items-center space-x-2">
              <Eye className="w-4 h-4 text-gray-500" />
              <span className="text-gray-600">Survolez pour voir le détail</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScoreDisplay;