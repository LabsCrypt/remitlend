/**
 * utils/soundManager.ts
 *
 * Sound effect manager for gamification features.
 *
 * The actual SoundManager class lives in soundManagerCore.ts, loaded via a
 * dynamic import() the first time useSoundEffect()'s returned play/setVolume/
 * setEnabled/preload is actually called (#1523). Consumers previously
 * imported useSoundEffect statically at module scope (GamificationSettings,
 * LevelUpModal, and GlobalXPGain — the last mounted globally in
 * app/layout.tsx), which pulled soundManagerCore's ~8 placeholder audio
 * clips and Audio-element setup into every page load regardless of whether
 * sound is enabled or the user ever triggers a sound effect. This file's
 * public API (useSoundEffect, getSoundManager, SoundEffect) is unchanged so
 * no call site needs to change — only the module actually doing the work is
 * now deferred.
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

type SoundManagerInstance = import("./soundManagerCore").SoundManager;

let corePromise: Promise<typeof import("./soundManagerCore")> | null = null;
let managerInstance: SoundManagerInstance | null = null;

// Calls made before the core module finishes loading are queued and
// replayed in order once the real manager is ready, so callers never need
// to await anything themselves.
let pendingCalls: Array<(manager: SoundManagerInstance) => void> = [];

function loadCore(): Promise<typeof import("./soundManagerCore")> {
  if (typeof window === "undefined") {
    // SSR: never actually resolves usefully, but nothing calls play() on
    // the server (see the SSR guard in useSoundEffect below), so this path
    // only exists to keep the types simple.
    return new Promise(() => {});
  }

  corePromise ??= import("./soundManagerCore").then((mod) => {
    managerInstance = new mod.SoundManager();
    for (const call of pendingCalls) call(managerInstance);
    pendingCalls = [];
    return mod;
  });

  return corePromise;
}

function withManager(fn: (manager: SoundManagerInstance) => void): void {
  if (managerInstance) {
    fn(managerInstance);
    return;
  }
  pendingCalls.push(fn);
  void loadCore();
}

/**
 * Returns the lazily-loaded singleton SoundManager once it has finished
 * loading, or null if the dynamic import hasn't resolved yet. Prefer
 * useSoundEffect() for normal call sites — this is only exposed for cases
 * that need synchronous access after confirming the manager is ready.
 */
export function getSoundManager(): SoundManagerInstance | null {
  void loadCore();
  return managerInstance;
}

/**
 * Hook to use sound manager with gamification store integration.
 *
 * The underlying SoundManager module is only fetched (via dynamic import)
 * the first time one of the returned methods is actually called — merely
 * calling useSoundEffect() (e.g. to read `sound` into a variable, as every
 * current consumer does) has no loading cost.
 */
export function useSoundEffect() {
  if (typeof window === "undefined") {
    return {
      play: () => {},
      setVolume: () => {},
      setEnabled: () => {},
      preload: () => {},
      preloadAll: () => {},
    };
  }

  return {
    play: (effect: SoundEffect) => withManager((manager) => manager.play(effect)),
    setVolume: (volume: number) => withManager((manager) => manager.setVolume(volume)),
    setEnabled: (enabled: boolean) => withManager((manager) => manager.setEnabled(enabled)),
    preload: (effect: SoundEffect) => withManager((manager) => manager.preload(effect)),
    preloadAll: () => withManager((manager) => manager.preloadAll()),
  };
}
