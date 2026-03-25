/**
 * utils/soundManager.ts
 *
 * Sound effect manager for gamification features.
 * Handles loading, playing, and managing audio files.
 */

export type SoundEffect =
  | "levelUp"
  | "achievement"
  | "success"
  | "signature"
  | "loanApproved"
  | "xpGain"
  | "click"
  | "error";

class SoundManager {
  private sounds: Map<SoundEffect, HTMLAudioElement> = new Map();
  private enabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    if (typeof window !== "undefined") {
      this.initializeSounds();
    }
  }

  private initializeSounds() {
    // Using data URIs for simple sound effects to avoid external dependencies
    // In production, replace with actual audio files

    const soundEffects: Record<SoundEffect, string> = {
      // Level up - triumphant sound
      levelUp: this.generateTone([523.25, 659.25, 783.99], 0.3, "sine"),

      // Achievement unlocked - success chime
      achievement: this.generateTone([659.25, 783.99, 987.77], 0.2, "sine"),

      // Success - positive feedback
      success: this.generateTone([523.25, 659.25], 0.15, "sine"),

      // Signature - confirmation sound
      signature: this.generateTone([440, 554.37], 0.1, "sine"),

      // Loan approved - celebration
      loanApproved: this.generateTone([523.25, 659.25, 783.99, 1046.5], 0.25, "sine"),

      // XP gain - quick positive feedback
      xpGain: this.generateTone([659.25, 783.99], 0.08, "sine"),

      // Click - subtle interaction
      click: this.generateTone([440], 0.05, "sine"),

      // Error - negative feedback
      error: this.generateTone([329.63, 293.66], 0.15, "sawtooth"),
    };

    // Create audio elements
    Object.entries(soundEffects).forEach(([key, dataUri]) => {
      const audio = new Audio(dataUri);
      audio.volume = this.volume;
      this.sounds.set(key as SoundEffect, audio);
    });
  }

  /**
   * Generate a simple tone using Web Audio API
   * This creates a data URI that can be used as an audio source
   */
  private generateTone(
    frequencies: number[],
    duration: number,
    waveType: OscillatorType = "sine",
  ): string {
    // For now, return empty data URI
    // In a real implementation, you would generate actual audio data
    // or use external audio files
    return "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
  }

  /**
   * Play a sound effect
   */
  play(effect: SoundEffect): void {
    if (!this.enabled) return;

    const sound = this.sounds.get(effect);
    if (sound) {
      // Clone the audio to allow overlapping sounds
      const clone = sound.cloneNode() as HTMLAudioElement;
      clone.volume = this.volume;
      clone.play().catch((error) => {
        // Silently fail if audio playback is blocked
        console.debug("Audio playback failed:", error);
      });
    }
  }

  /**
   * Set volume for all sounds (0-1)
   */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.sounds.forEach((sound) => {
      sound.volume = this.volume;
    });
  }

  /**
   * Enable or disable all sounds
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Preload a specific sound
   */
  preload(effect: SoundEffect): void {
    const sound = this.sounds.get(effect);
    if (sound) {
      sound.load();
    }
  }

  /**
   * Preload all sounds
   */
  preloadAll(): void {
    this.sounds.forEach((sound) => sound.load());
  }
}

// Singleton instance
let soundManagerInstance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!soundManagerInstance && typeof window !== "undefined") {
    soundManagerInstance = new SoundManager();
  }
  return soundManagerInstance!;
}

/**
 * Hook to use sound manager with gamification store integration
 */
export function useSoundEffect() {
  if (typeof window === "undefined") {
    return {
      play: () => {},
      setVolume: () => {},
      setEnabled: () => {},
    };
  }

  const manager = getSoundManager();

  return {
    play: (effect: SoundEffect) => manager.play(effect),
    setVolume: (volume: number) => manager.setVolume(volume),
    setEnabled: (enabled: boolean) => manager.setEnabled(enabled),
    preload: (effect: SoundEffect) => manager.preload(effect),
    preloadAll: () => manager.preloadAll(),
  };
}
