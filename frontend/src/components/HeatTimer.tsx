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
  compact?: boolean;
  landscape?: boolean;
  embedded?: boolean;
  configSaved: boolean;
  disabled?: boolean;
}

function HeatTimer({
  timer,
  onStart,
  onPause,
  onReset,
  onDurationChange,
  showControls = true,
  size = 'medium',
  compact = false,
  landscape = false,
  embedded = false,
  configSaved,
  disabled = false
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
        const remaining = Math.min(
          syncedTimer.duration * 60,
          Math.max(0, syncedTimer.duration * 60 - elapsed)
        );
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
          remaining = Math.min(
            timer.duration * 60,
            Math.max(0, timer.duration * 60 - elapsed)
          );
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
    const roundedSeconds = Math.floor(seconds);
    const mins = Math.floor(roundedSeconds / 60);
    const secs = roundedSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getTimerColor = (): string => {
    if (timeLeft <= 5) return 'text-red-500 animate-pulse';
    if (timeLeft <= 60) return 'text-red-600';
    if (timeLeft <= 300) return 'text-cta-500';
    return 'text-primary-600';
  };

  const getTimerBgColor = (): string => {
    if (embedded) return 'bg-primary-950/10 border-primary-200/25';
    if (timeLeft <= 5) return 'bg-red-50 border-red-500';
    if (timeLeft <= 300) return 'bg-cta-50 border-cta-500/30';
    return 'bg-primary-50 border-primary-500/20';
  };

  const getEmbeddedTimerColor = (): string => {
    if (timeLeft <= 5) return 'text-red-100 animate-pulse';
    if (timeLeft <= 60) return 'text-amber-100';
    if (timeLeft <= 300) return 'text-violet-100';
    return 'text-white';
  };

  const getSizeClasses = () => {
    switch (size) {
      case 'small':
        return {
          container: 'p-2',
          time: 'text-2xl',
          button: 'p-1.5',
          icon: 'w-3.5 h-3.5'
        };
      case 'large':
        return {
          container: 'p-8',
          time: 'text-7xl sm:text-8xl',
          button: 'p-4',
          icon: 'w-6 h-6'
        };
      default:
        return {
          container: 'p-4 sm:p-6',
          time: 'text-4xl sm:text-6xl',
          button: 'p-3',
          icon: 'w-5 h-5'
        };
    }
  };

  const classes = getSizeClasses();

  return (
    <div className={`${embedded ? 'bg-primary-950/10 backdrop-blur-sm' : 'bg-white'} rounded-2xl border-4 ${getTimerBgColor()} ${classes.container} ${landscape ? 'w-full max-w-3xl' : ''} text-center transition-all duration-300 ${embedded ? 'shadow-none' : compact ? 'shadow-sm' : 'shadow-block'} ${embedded ? 'mb-0' : ''}`}>
      {!compact && (
        <div className={`flex items-center ${landscape ? 'justify-between gap-4 mb-2' : 'justify-center mb-4'}`}>
          <Clock className={`w-6 h-6 mr-2 ${embedded ? 'text-violet-100' : timeLeft <= 300 ? 'text-cta-500' : 'text-primary-600'}`} />
          <h3 className={`text-lg font-bebas tracking-widest ${embedded ? 'text-violet-50' : timeLeft <= 300 ? 'text-cta-600' : 'text-primary-800'} ${landscape ? 'mr-auto' : ''}`}>
            CHRONO <span className="opacity-60 text-sm">PRO</span>
          </h3>
          {showControls && (
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`ml-2 p-1 transition-colors ${embedded ? 'text-violet-100/80 hover:text-white' : 'text-primary-400 hover:text-primary-600'}`}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {showSettings && showControls && !compact && (
        <div className="mb-4 p-4 bg-primary-50 rounded-xl border-2 border-primary-100 flex items-center justify-center gap-4 animate-fade-in">
          <label className="text-[10px] font-bold text-primary-900/60 uppercase tracking-widest">Durée (min)</label>
          <input
            type="number"
            min="1"
            max="60"
            value={timer.duration}
            onChange={(e) => onDurationChange(parseInt(e.target.value) || 20)}
            className="w-20 px-3 py-1.5 bg-white border-2 border-primary-200 rounded-lg text-center font-bold text-primary-900 focus:border-primary-600 focus:ring-0 disabled:bg-gray-100 disabled:text-gray-400"
            disabled={timer.isRunning || disabled}
          />
        </div>
      )}

      <div className={`${landscape ? 'flex items-center justify-between gap-4' : ''}`}>
        <div className={`font-bebas tracking-[0.1em] leading-none ${compact ? 'mb-1' : landscape ? 'mb-0 text-left' : 'mb-6'} ${classes.time} ${embedded ? getEmbeddedTimerColor() : getTimerColor()}`}>
          {formatTime(timeLeft)}
        </div>

        <div className={`${compact ? 'min-h-[20px] pb-1' : landscape ? 'min-h-0 flex-1 justify-end' : 'min-h-[40px]'} flex items-center justify-center`}>
        {timeLeft <= 5 && timeLeft > 0 && (
          <div className="px-4 py-1.5 bg-red-600 text-white rounded-full border-2 border-primary-950 font-bold text-[10px] uppercase tracking-widest animate-pulse shadow-block">
            🚨 {timeLeft} SECONDE{timeLeft > 1 ? 'S' : ''} !
          </div>
        )}

        {timeLeft <= 60 && timeLeft > 5 && (
          <div className="px-4 py-1.5 bg-red-100 text-red-600 rounded-full border-2 border-red-200 font-bold text-[10px] uppercase tracking-widest">
            ⚠️ Dernière minute
          </div>
        )}

        {timeLeft <= 300 && timeLeft > 60 && (
          <div className="px-4 py-1.5 bg-cta-50 text-cta-600 rounded-full border-2 border-cta-100 font-bold text-[10px] uppercase tracking-widest">
            🔔 5 dernières minutes
          </div>
        )}

        {timeLeft === 0 && timer.startTime && (
          <div className="px-6 py-2 bg-red-600 text-white rounded-full border-4 border-primary-950 font-bebas text-xl tracking-widest animate-pulse shadow-block">
            🏁 TEMPS ÉCOULÉ !
          </div>
        )}
        </div>
      </div>

      {showControls && (
        <div className="flex justify-center space-x-3 mt-4">
          {!timer.isRunning ? (
            <button
              onClick={onStart}
              disabled={!configSaved || disabled}
              className={`${classes.button} bg-success-500 text-white rounded-xl border-2 border-primary-950 shadow-block hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 font-bebas tracking-widest px-6 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Play className={classes.icon} fill="currentColor" />
              <span>START</span>
            </button>
          ) : (
            <button
              onClick={onPause}
              disabled={disabled}
              className={`${classes.button} bg-cta-500 text-white rounded-xl border-2 border-primary-950 shadow-block hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2 font-bebas tracking-widest px-6 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <Pause className={classes.icon} fill="currentColor" />
              <span>PAUSE</span>
            </button>
          )}

          <button
            onClick={onReset}
            disabled={!configSaved || disabled}
            className={`${classes.button} bg-white text-primary-900 rounded-xl border-2 border-primary-950 hover:bg-primary-50 transition-all flex items-center gap-2 font-bebas tracking-widest px-6 disabled:opacity-50 disabled:bg-gray-100 disabled:cursor-not-allowed`}
          >
            <RotateCcw className={classes.icon} />
            <span>RESET</span>
          </button>
        </div>
      )}

      {!configSaved && showControls && (
        <p className="mt-4 text-[10px] font-bold text-cta-600 uppercase tracking-widest animate-pulse">
          ⚠️ Sauvegardez la configuration
        </p>
      )}
    </div>
  );
}

export default HeatTimer;
