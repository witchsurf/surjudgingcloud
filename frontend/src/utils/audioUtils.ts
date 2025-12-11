// Utilitaires pour les sons du timer
type BeepAudioElement = HTMLAudioElement & {
  playBeep?: () => void;
};

type ExtendedWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export class TimerAudio {
  private static instance: TimerAudio;
  private fiveMinuteAlarm: BeepAudioElement | null = null;
  private countdownBeep: BeepAudioElement | null = null;
  private finalBeep: BeepAudioElement | null = null;

  private constructor() {
    this.initializeAudio();
  }

  static getInstance(): TimerAudio {
    if (!TimerAudio.instance) {
      TimerAudio.instance = new TimerAudio();
    }
    return TimerAudio.instance;
  }

  private initializeAudio() {
    try {
      // Créer les sons avec des fréquences différentes
      this.fiveMinuteAlarm = this.createBeep(800, 0.3, 1000); // Son grave pour 5 minutes
      this.countdownBeep = this.createBeep(1000, 0.2, 200); // Son aigu pour countdown
      this.finalBeep = this.createBeep(1200, 0.5, 2000); // Son final
    } catch (error) {
      console.warn('Impossible de créer les sons audio:', error);
    }
  }

  private createBeep(frequency: number, volume: number, duration: number): BeepAudioElement {
    // Créer un contexte audio pour générer des bips
    const extendedWindow = window as ExtendedWindow;
    const AudioContextConstructor = window.AudioContext ?? extendedWindow.webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error('AudioContext non supporté par ce navigateur');
    }

    const audioContext = new AudioContextConstructor();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
    
    // Créer un élément audio factice pour l'interface
    const audio = new Audio() as BeepAudioElement;
    audio.volume = volume;
    
    // Fonction personnalisée pour jouer le son
    audio.playBeep = () => {
      try {
        const newOscillator = audioContext.createOscillator();
        const newGainNode = audioContext.createGain();
        
        newOscillator.connect(newGainNode);
        newGainNode.connect(audioContext.destination);
        
        newOscillator.frequency.value = frequency;
        newOscillator.type = 'sine';
        
        newGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        newGainNode.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
        newGainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration / 1000);
        
        newOscillator.start(audioContext.currentTime);
        newOscillator.stop(audioContext.currentTime + duration / 1000);
      } catch (error) {
        console.warn('Erreur lors de la lecture du son:', error);
      }
    };
    
    return audio;
  }

  playFiveMinuteAlarm() {
    if (this.fiveMinuteAlarm?.playBeep) {
      this.fiveMinuteAlarm.playBeep();
      console.log('🔔 Alarme 5 minutes !');
    }
  }

  playCountdownBeep() {
    if (this.countdownBeep?.playBeep) {
      this.countdownBeep.playBeep();
      console.log('⏰ Bip countdown !');
    }
  }

  playFinalBeep() {
    if (this.finalBeep?.playBeep) {
      this.finalBeep.playBeep();
      console.log('🏁 Bip final !');
    }
  }
}
