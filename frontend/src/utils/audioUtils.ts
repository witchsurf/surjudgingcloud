// Utilitaires pour les sons du timer
type BeepAudioElement = HTMLAudioElement & {
  playBeep?: () => void;
};

type ExtendedWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export class TimerAudio {
  private static instance: TimerAudio;
  private audioContext: AudioContext | null = null;

  private constructor() {
    // Don't initialize audio here - wait for user gesture
  }

  static getInstance(): TimerAudio {
    if (!TimerAudio.instance) {
      TimerAudio.instance = new TimerAudio();
    }
    return TimerAudio.instance;
  }

  private ensureAudioContext() {
    if (!this.audioContext) {
      try {
        const extendedWindow = window as ExtendedWindow;
        const AudioContextConstructor = window.AudioContext ?? extendedWindow.webkitAudioContext;
        if (!AudioContextConstructor) {
          throw new Error('AudioContext non supporté par ce navigateur');
        }
        this.audioContext = new AudioContextConstructor();

        // Resume context if suspended (Chrome autoplay policy)
        if (this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(err => {
            console.warn('Could not resume AudioContext:', err);
          });
        }
      } catch (error) {
        console.warn('Impossible de créer AudioContext:', error);
      }
    }
    return this.audioContext;
  }

  private playBeep(frequency: number, volume: number, duration: number) {
    const audioContext = this.ensureAudioContext();
    if (!audioContext) return;

    try {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = frequency;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + duration / 1000);
    } catch (error) {
      console.warn('Erreur lors de la lecture du son:', error);
    }
  }

  playFiveMinuteAlarm() {
    console.log('🔔 Alarme 5 minutes !');
    this.playBeep(800, 0.3, 1000);
  }

  playStartHorn() {
    console.log('▶️ Start horn !');
    this.playBeep(900, 0.28, 180);
    window.setTimeout(() => this.playBeep(1150, 0.35, 260), 220);
  }

  playCountdownBeep() {
    console.log('⏰ Bip countdown !');
    this.playBeep(1000, 0.2, 200);
  }

  playFinalBeep() {
    console.log('🏁 Bip final !');
    this.playBeep(1200, 0.5, 2000);
  }

  stopAll() {
    // Stop all sounds by closing and recreating context
    if (this.audioContext) {
      this.audioContext.close().catch(err => console.warn('Error closing AudioContext:', err));
      this.audioContext = null;
    }
  }
}
