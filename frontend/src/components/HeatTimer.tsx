import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Clock, Settings } from 'lucide-react';
import { TimerAudio } from '../utils/audioUtils';
import type { HeatTimer as HeatTimerType } from '../types';

interface HeatTimerProps {
  timer: HeatTimerType;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onDurationChange: (duration: number) => void;
  showControls?: boolean;
  size?: 'small' | 'medium' | 'large';
  configSaved: boolean;
}

function HeatTimer({
  timer,
  onStart,
  onPause,
  onReset,
  onDurationChange,
  showControls = true,
  size = 'medium',
  configSaved
}: HeatTimerProps) {
  const [timeLeft, setTimeLeft] = useState(timer.duration * 60);
  const [showSettings, setShowSettings] = useState(false);
  const [fiveMinuteAlarmPlayed, setFiveMinuteAlarmPlayed] = useState(false);
  const [lastCountdownSecond, setLastCountdownSecond] = useState(-1);
  const [finalBeepPlayed, setFinalBeepPlayed] = useState(false);
  const timerAudio = TimerAudio.getInstance();

  // Écouter les événements de synchronisation du timer
  useEffect(() => {
    // Fonction pour synchroniser le timer depuis localStorage
    // localStorage sync REMOVED - using Supabase realtime only
    // This fixes infinite loop issue

    const handleTimerSync = (e: CustomEvent) => {
      const syncedTimer = e.detail;
      console.log('📡 Événement timerSync reçu:', syncedTimer);
      if (syncedTimer.startTime) {
        const startTime = typeof syncedTimer.startTime === 'string'
          ? new Date(syncedTimer.startTime)
          : syncedTimer.startTime;
        const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
        const remaining = Math.max(0, syncedTimer.duration * 60 - elapsed);
        setTimeLeft(remaining);
        console.log('⏰ Timer mis à jour via événement:', { remaining, elapsed });
      } else {
        // Reset des alarmes si le timer est réinitialisé
        setFiveMinuteAlarmPlayed(false);
        setLastCountdownSecond(-1);
        setTimeLeft(syncedTimer.duration * 60);
        console.log('⏰ Timer reset via événement:', { duration: syncedTimer.duration });
      }
    };

    // Storage event listener REMOVED - no longer using localStorage for timer

    // Initial sync from Supabase realtime only (see handleTimerSync)

    window.addEventListener('timerSync', handleTimerSync as EventListener);

    return () => {
      window.removeEventListener('timerSync', handleTimerSync as EventListener);
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (timer.isRunning) {
      interval = setInterval(() => {
        let remaining = timeLeft;
        if (timer.startTime) {
          const elapsed = Math.floor((Date.now() - new Date(timer.startTime).getTime()) / 1000);
          remaining = Math.max(0, timer.duration * 60 - elapsed);
        } else {
          // Fallback: décrémente localement si pas de startTime
          remaining = Math.max(0, remaining - 1);
        }
        setTimeLeft(remaining);

        // Alarme 5 minutes (300 secondes)
        if (remaining === 300 && !fiveMinuteAlarmPlayed) {
          timerAudio.playFiveMinuteAlarm();
          setFiveMinuteAlarmPlayed(true);
        }

        // Countdown des 5 dernières secondes
        if (remaining <= 5 && remaining > 0 && remaining !== lastCountdownSecond) {
          timerAudio.playCountdownBeep();
          setLastCountdownSecond(remaining);
        }

        // Son final quand le temps est écoulé (play only once!)
        if (remaining === 0 && !finalBeepPlayed) {
          timerAudio.playFinalBeep();
          setFinalBeepPlayed(true);
          onPause();
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timer.isRunning, timer.startTime, timer.duration, onPause, timeLeft, fiveMinuteAlarmPlayed, lastCountdownSecond, finalBeepPlayed, timerAudio]);

  useEffect(() => {
    if (!timer.isRunning && !timer.startTime) {
      setTimeLeft(timer.duration * 60);
      setFiveMinuteAlarmPlayed(false);
      setLastCountdownSecond(-1);
      setFinalBeepPlayed(false);
      timerAudio.stopAll?.();
    }
  }, [timer.duration, timer.isRunning, timer.startTime, timerAudio]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = (): string => {
    if (timeLeft <= 5) return 'text-red-600 animate-pulse'; // 5 dernières secondes - rouge clignotant
    if (timeLeft <= 60) return 'text-red-600'; // Dernière minute - rouge
    if (timeLeft <= 300) return 'text-orange-500'; // 5 dernières minutes - orange
    return 'text-green-600'; // Normal - vert
  };

  const getTimerBgColor = (): string => {
    if (timeLeft <= 5) return 'bg-red-100 border-red-300'; // 5 dernières secondes
    if (timeLeft <= 60) return 'bg-red-50 border-red-200'; // Dernière minute
    if (timeLeft <= 300) return 'bg-orange-50 border-orange-200'; // 5 dernières minutes
    return 'bg-green-50 border-green-200'; // Normal
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return {
          container: 'p-4',
          time: 'text-2xl',
          button: 'p-2',
          icon: 'w-4 h-4'
        };
      case 'large':
        return {
          container: 'p-8',
          time: 'text-6xl',
          button: 'p-4',
          icon: 'w-6 h-6'
        };
      default:
        return {
          container: 'p-6',
          time: 'text-4xl',
          button: 'p-3',
          icon: 'w-5 h-5'
        };
    }
  };

  const classes = getSizeClasses();

  return (
    <div className={`bg-white rounded-xl border-2 ${getTimerBgColor()} ${classes.container} text-center transition-all duration-300`}>
      <div className="flex items-center justify-center mb-4">
        <Clock className={`w-6 h-6 mr-2 ${timeLeft <= 300 ? 'text-orange-600' : 'text-green-600'}`} />
        <h3 className={`text-lg font-semibold ${timeLeft <= 300 ? 'text-orange-800' : 'text-green-800'}`}>
          Timer du Heat
        </h3>
        {showControls && (
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`ml-2 p-1 transition-colors ${timeLeft <= 300 ? 'text-orange-500 hover:text-orange-700' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>

      {showSettings && showControls && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Durée (minutes)
          </label>
          <input
            type="number"
            min="1"
            max="60"
            value={timer.duration}
            onChange={(e) => onDurationChange(parseInt(e.target.value) || 20)}
            className="w-20 px-2 py-1 border border-gray-300 rounded text-center"
            disabled={timer.isRunning}
          />
        </div>
      )}

      <div className={`font-mono font-bold mb-6 ${classes.time} ${getTimerColor()}`}>
        {formatTime(timeLeft)}
      </div>

      {timeLeft <= 5 && timeLeft > 0 && (
        <div className="mb-4 px-3 py-2 bg-red-200 border border-red-400 rounded-lg animate-pulse">
          <p className="text-red-900 font-bold">🚨 {timeLeft} SECONDE{timeLeft > 1 ? 'S' : ''} !</p>
        </div>
      )}

      {timeLeft <= 60 && timeLeft > 5 && (
        <div className="mb-4 px-3 py-2 bg-red-100 border border-red-300 rounded-lg">
          <p className="text-red-800 font-bold">⚠️ Dernière minute !</p>
        </div>
      )}

      {timeLeft <= 300 && timeLeft > 60 && (
        <div className="mb-4 px-3 py-2 bg-orange-100 border border-orange-300 rounded-lg">
          <p className="text-orange-800 font-medium">🔔 5 dernières minutes !</p>
        </div>
      )}

      {timeLeft === 0 && (
        <div className="mb-4 px-3 py-2 bg-red-600 text-white rounded-lg animate-pulse">
          <p className="font-bold">🏁 TEMPS ÉCOULÉ !</p>
        </div>
      )}

      {showControls && (
        <div className="flex justify-center space-x-3">
          {!timer.isRunning ? (
            <button
              onClick={onStart}
              disabled={!configSaved}
              className={`${classes.button} bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-all duration-200`}
            >
              <Play className={classes.icon} />
              <span>Start</span>
            </button>
          ) : (
            <button
              onClick={onPause}
              className={`${classes.button} bg-orange-600 text-white rounded-lg hover:bg-orange-700 flex items-center space-x-2 font-medium transition-all duration-200`}
            >
              <Pause className={classes.icon} />
              <span>Pause</span>
            </button>
          )}

          <button
            onClick={onReset}
            disabled={!configSaved}
            className={`${classes.button} bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-all duration-200`}
          >
            <RotateCcw className={classes.icon} />
            <span>Reset</span>
          </button>
        </div>
      )}

      {!configSaved && showControls && (
        <p className="mt-3 text-sm text-orange-600">
          ⚠️ Enregistrez la configuration pour utiliser le timer
        </p>
      )}
    </div>
  );
}

export default HeatTimer;
