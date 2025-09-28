// Utilitaires pour les sons du timer
export class TimerAudio {
  private static instance: TimerAudio;
  private fiveMinuteAlarm: HTMLAudioElement | null = null;
  private countdownBeep: HTMLAudioElement | null = null;
  private finalBeep: HTMLAudioElement | null = null;

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

  private createBeep(frequency: number, volume: number, duration: number): HTMLAudioElement {
    // Créer un contexte audio pour générer des bips
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    const audio = new Audio();
    audio.volume = volume;
    
    // Fonction personnalisée pour jouer le son
    (audio as any).playBeep = () => {
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
    if (this.fiveMinuteAlarm && (this.fiveMinuteAlarm as any).playBeep) {
      (this.fiveMinuteAlarm as any).playBeep();
      console.log('🔔 Alarme 5 minutes !');
    }
  }

  playCountdownBeep() {
    if (this.countdownBeep && (this.countdownBeep as any).playBeep) {
      (this.countdownBeep as any).playBeep();
      console.log('⏰ Bip countdown !');
    }
  }

  playFinalBeep() {
    if (this.finalBeep && (this.finalBeep as any).playBeep) {
      (this.finalBeep as any).playBeep();
      console.log('🏁 Bip final !');
    }
  }
}