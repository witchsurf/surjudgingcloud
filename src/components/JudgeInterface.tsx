import React, { useState, useEffect } from 'react';
import { User, Waves, Clock, AlertCircle, CheckCircle, Lock, CreditCard as Edit3 } from 'lucide-react';
import { SURFER_COLORS } from '../utils/constants';
import type { AppConfig, Score, HeatTimer } from '../types';
import HeatTimer from './HeatTimer';

interface JudgeInterfaceProps {
  config: AppConfig;
  judgeId: string;
  onScoreSubmit: (scoreData: Omit<Score, 'id' | 'created_at' | 'heat_id' | 'timestamp'>) => void;
  configSaved: boolean;
  timer: HeatTimer;
}

interface ScoreInputState {
  surfer: string;
  wave: number;
  value: string;
}

function JudgeInterface({ config, judgeId, onScoreSubmit, configSaved, timer }: JudgeInterfaceProps) {
  const [submittedScores, setSubmittedScores] = useState<Score[]>([]);
  const [activeInput, setActiveInput] = useState<ScoreInputState | null>(null);
  const [inputValue, setInputValue] = useState('');

  // Charger les scores soumis depuis localStorage
  useEffect(() => {
    const savedScores = localStorage.getItem('surfJudgingScores');
    if (savedScores) {
      try {
        const parsedScores = JSON.parse(savedScores);
        const judgeScores = parsedScores.filter((s: Score) => s.judge_id === judgeId);
        setSubmittedScores(judgeScores);
      } catch (error) {
        console.error('Erreur chargement scores juge:', error);
      }
    }
  }, [judgeId]);

  // Écouter les changements de scores
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'surfJudgingScores' && e.newValue) {
        try {
          const parsedScores = JSON.parse(e.newValue);
          const judgeScores = parsedScores.filter((s: Score) => s.judge_id === judgeId);
          setSubmittedScores(judgeScores);
        } catch (error) {
          console.error('Erreur sync scores juge:', error);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [judgeId]);

  // Vérifier si le timer est actif
  const isTimerActive = () => {
    if (!timer.startTime) return false;
    
    const now = new Date();
    const startTime = new Date(timer.startTime);
    const elapsedMinutes = (now.getTime() - startTime.getTime()) / (1000 * 60);
    const remainingTime = timer.duration - elapsedMinutes;
    
    return remainingTime > 0;
  };

  const getScoreForWave = (surfer: string, wave: number) => {
    return submittedScores.find(
      s => s.surfer === surfer && s.wave_number === wave && s.judge_id === judgeId
    );
  };

  const getNextAvailableWave = (surfer: string): number => {
    // Trouver la première vague non notée pour ce surfeur
    for (let wave = 1; wave <= config.waves; wave++) {
      if (!getScoreForWave(surfer, wave)) {
        return wave;
      }
    }
    return config.waves + 1; // Toutes les vagues sont notées
  };

  const canScoreWave = (surfer: string, wave: number): boolean => {
    if (!isTimerActive()) return false;
    
    // On peut noter une vague seulement si c'est la prochaine vague disponible
    const nextWave = getNextAvailableWave(surfer);
    return wave === nextWave;
  };

  const handleCellClick = (surfer: string, wave: number) => {
    if (!canScoreWave(surfer, wave)) return;
    
    const existingScore = getScoreForWave(surfer, wave);
    setActiveInput({ surfer, wave, value: existingScore?.score.toString() || '' });
    setInputValue(existingScore?.score.toString() || '');
  };

  const handleScoreSubmit = async () => {
    if (!activeInput || !inputValue.trim()) return;

    const scoreValue = parseFloat(inputValue.replace(',', '.'));
    if (isNaN(scoreValue) || scoreValue < 0 || scoreValue > 10) {
      alert('Le score doit être entre 0 et 10');
      return;
    }

    try {
      const judgeName = config.judgeNames[judgeId] || judgeId;
      
      await onScoreSubmit({
        competition: config.competition,
        division: config.division,
        round: config.round,
        judge_id: judgeId,
        judge_name: judgeName,
        surfer: activeInput.surfer,
        wave_number: activeInput.wave,
        score: scoreValue
      });

      setActiveInput(null);
      setInputValue('');
      
    } catch (error) {
      console.error('❌ Erreur soumission score:', error);
      alert('Erreur lors de la soumission du score');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleScoreSubmit();
    } else if (e.key === 'Escape') {
      setActiveInput(null);
      setInputValue('');
    }
  };

  const getSurferColor = (surfer: string) => {
    return SURFER_COLORS[surfer] || '#6B7280';
  };

  if (!configSaved) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-8 text-center">
          <Waves className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-blue-800 mb-2">En attente de configuration</h2>
          <p className="text-blue-700">
            L'interface de notation sera disponible une fois la compétition configurée.
          </p>
        </div>
      </div>
    );
  }

  const timerActive = isTimerActive();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* HEADER JUGE */}
      <div className="bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Interface Juge</h1>
            <div className="flex items-center space-x-4 text-green-100">
              <span className="flex items-center">
                <User className="w-4 h-4 mr-1" />
                {config.judgeNames[judgeId] || judgeId}
              </span>
              <span>{config.competition}</span>
              <span>{config.division}</span>
              <span>R{config.round} - H{config.heatId}</span>
            </div>
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
          size="medium"
          configSaved={configSaved}
        />
      </div>

      {/* STATUT TIMER */}
      {!timerActive && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center space-x-3">
          <Lock className="w-6 h-6 text-red-600" />
          <div>
            <h3 className="font-semibold text-red-800">Timer arrêté - Notation bloquée</h3>
            <p className="text-red-700 text-sm">
              La notation est désactivée car le timer n'est pas en cours d'exécution.
            </p>
          </div>
        </div>
      )}

      {/* GRILLE DE NOTATION */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900 flex items-center">
            <Waves className="w-6 h-6 mr-2 text-blue-600" />
            Grille de notation - {config.waves} vagues maximum
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            Cliquez sur une case pour noter. Les vagues doivent être notées dans l'ordre.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900 sticky left-0 bg-gray-50">
                  Surfeur
                </th>
                {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => (
                  <th key={wave} className="px-3 py-3 text-center text-sm font-semibold text-gray-900 min-w-[60px]">
                    V{wave}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {config.surfers.map((surfer, index) => (
                <tr key={surfer} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-3 sticky left-0 bg-inherit">
                    <div className="flex items-center space-x-3">
                      <div
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: getSurferColor(surfer) }}
                      />
                      <span className="font-semibold text-gray-900">{surfer}</span>
                    </div>
                  </td>
                  {Array.from({ length: config.waves }, (_, i) => i + 1).map(wave => {
                    const scoreData = getScoreForWave(surfer, wave);
                    const canScore = canScoreWave(surfer, wave);
                    const isActive = activeInput?.surfer === surfer && activeInput?.wave === wave;
                    
                    return (
                      <td key={wave} className="px-3 py-3 text-center">
                        {isActive ? (
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.01"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyPress}
                            onBlur={() => {
                              if (inputValue.trim()) {
                                handleScoreSubmit();
                              } else {
                                setActiveInput(null);
                                setInputValue('');
                              }
                            }}
                            className="w-16 px-2 py-1 text-center border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="0.00"
                            autoFocus
                          />
                        ) : scoreData ? (
                          <button
                            onClick={() => handleCellClick(surfer, wave)}
                            className="inline-flex items-center px-2 py-1 bg-green-100 text-green-800 rounded text-sm font-medium hover:bg-green-200 transition-colors"
                            disabled={!timerActive}
                          >
                            {scoreData.score.toFixed(2)}
                            <Edit3 className="w-3 h-3 ml-1" />
                          </button>
                        ) : canScore ? (
                          <button
                            onClick={() => handleCellClick(surfer, wave)}
                            className="w-16 h-8 border-2 border-dashed border-blue-300 rounded text-blue-600 hover:border-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center"
                            title={`Noter la vague ${wave} pour ${surfer}`}
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* LÉGENDE */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center justify-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-dashed border-blue-300 rounded"></div>
              <span className="text-gray-600">Prochaine vague à noter</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-block px-2 py-1 bg-green-100 text-green-800 rounded text-xs">7.50</span>
              <span className="text-gray-600">Score déjà noté (cliquez pour modifier)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-gray-400">—</span>
              <span className="text-gray-600">Vague non disponible</span>
            </div>
          </div>
          <p className="text-center text-xs text-gray-500 mt-2">
            ⚠️ Les vagues doivent être notées dans l'ordre séquentiel pour chaque surfeur
          </p>
        </div>
      </div>

      {/* RÉSUMÉ DES SCORES */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Mes scores soumis ({submittedScores.length})
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {config.surfers.map(surfer => {
            const surferScores = submittedScores.filter(s => s.surfer === surfer);
            const nextWave = getNextAvailableWave(surfer);
            
            return (
              <div key={surfer} className="p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getSurferColor(surfer) }}
                  />
                  <span className="font-medium text-gray-900">{surfer}</span>
                </div>
                <div className="text-sm text-gray-600">
                  {surferScores.length} vague{surferScores.length > 1 ? 's' : ''} notée{surferScores.length > 1 ? 's' : ''}
                </div>
                {nextWave <= config.waves && (
                  <div className="text-xs text-blue-600 mt-1">
                    Prochaine: V{nextWave}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default JudgeInterface;