/**
 * utils/soundManagerCore.ts
 *
 * The actual SoundManager implementation. Split out of soundManager.ts
 * (#1523) so it can be loaded via a dynamic import() gated on the first
 * real sound trigger, instead of being pulled into every bundle that
 * imports soundManager.ts's useSoundEffect() hook regardless of whether
 * the user ever plays a sound. Do not import this module directly from
 * components — use useSoundEffect() from ./soundManager instead.
 */

import type { SoundEffect } from "./soundManager";

export class SoundManager {
  private sounds: Map<SoundEffect, HTMLAudioElement> = new Map();
  private enabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    if (typeof window !== "undefined") {
      this.initializeSounds();
    }
  }

  private initializeSounds() {
    // Placeholder silent sound effects.
    // Replace with real audio assets or generated tones in production.

    const soundEffects: Record<SoundEffect, string> = {
      // Level up - triumphant sound
      levelUp: this.generateTone([523.25, 659.25, 783.99], 0.3),

      // Achievement unlocked - success chime
      achievement: this.generateTone([659.25, 783.99, 987.77], 0.2),

      // Success - positive feedback
      success: this.generateTone([523.25, 659.25], 0.15),

      // Signature - confirmation sound
      signature: this.generateTone([440, 554.37], 0.1),

      // Loan approved - celebration
      loanApproved: this.generateTone([523.25, 659.25, 783.99, 1046.5], 0.25),

      // XP gain - quick positive feedback
      xpGain: this.generateTone([659.25, 783.99], 0.08),

      // Click - subtle interaction
      click: this.generateTone([440], 0.05),

      // Error - negative feedback
      error: this.generateTone([329.63, 293.66], 0.15),
    };

    // Create audio elements
    Object.entries(soundEffects).forEach(([key, dataUri]) => {
      const audio = new Audio(dataUri);
      audio.volume = this.volume;
      this.sounds.set(key as SoundEffect, audio);
    });
  }

  /**
   * Placeholder sound generator.
   *
   * Gamification sound effects are currently disabled and all generated
   * clips are intentionally silent placeholders until real audio assets
   * or Web Audio API tone generation is implemented.
   *
   * The frequency and duration parameters are currently unused.
   */
  private generateTone(_frequencies: number[], _duration: number): string {
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
