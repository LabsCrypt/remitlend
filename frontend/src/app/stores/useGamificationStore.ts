/**
 * stores/useGamificationStore.ts
 *
 * Zustand store for gamification features - Kingdom experience.
 *
 * Responsibilities:
 *  - Track user level, XP, and achievements
 *  - Manage sound and animation preferences
 *  - Handle level-up events and rewards
 *  - Store Kingdom progression state
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export type KingdomLevel = "Peasant" | "Merchant" | "Knight" | "Baron" | "Duke" | "Prince" | "King";

export interface Achievement {
  id: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt?: string;
  progress?: number;
  maxProgress?: number;
}

export interface LevelUpReward {
  level: number;
  title: KingdomLevel;
  xpRequired: number;
  rewards: string[];
}

interface GamificationState {
  // Kingdom progression
  level: number;
  xp: number;
  kingdomTitle: KingdomLevel;
  achievements: Achievement[];

  // Settings
  soundEnabled: boolean;
  animationsEnabled: boolean;
  soundVolume: number; // 0-1

  // UI state
  showLevelUpModal: boolean;
  pendingLevelUp: LevelUpReward | null;
  recentXPGain: { amount: number; reason: string; id: number } | null;
}

interface GamificationActions {
  // XP and leveling
  addXP: (amount: number, reason?: string) => void;
  clearRecentXPGain: () => void;
  setLevel: (level: number) => void;
  checkLevelUp: () => void;
  dismissLevelUp: () => void;

  // Achievements
  unlockAchievement: (achievementId: string) => void;
  updateAchievementProgress: (achievementId: string, progress: number) => void;

  // Settings
  toggleSound: () => void;
  toggleAnimations: () => void;
  setSoundVolume: (volume: number) => void;

  // Reset
  resetGamification: () => void;
}

export type GamificationStore = GamificationState & GamificationActions;

// ─── Level progression ────────────────────────────────────────────────────────

const LEVEL_THRESHOLDS: LevelUpReward[] = [
  { level: 1, title: "Peasant", xpRequired: 0, rewards: ["Welcome to the Kingdom!"] },
  {
    level: 2,
    title: "Merchant",
    xpRequired: 100,
    rewards: ["Unlock basic trading", "5% fee discount"],
  },
  {
    level: 3,
    title: "Knight",
    xpRequired: 300,
    rewards: ["Priority loan processing", "10% fee discount"],
  },
  {
    level: 4,
    title: "Baron",
    xpRequired: 600,
    rewards: ["Access to premium loans", "15% fee discount"],
  },
  {
    level: 5,
    title: "Duke",
    xpRequired: 1000,
    rewards: ["VIP support", "20% fee discount", "Exclusive badges"],
  },
  {
    level: 6,
    title: "Prince",
    xpRequired: 1500,
    rewards: ["Governance voting rights", "25% fee discount"],
  },
  {
    level: 7,
    title: "King",
    xpRequired: 2500,
    rewards: ["Maximum benefits", "30% fee discount", "Kingdom crown NFT"],
  },
];

function getKingdomTitle(level: number): KingdomLevel {
  const threshold = LEVEL_THRESHOLDS.find((t) => t.level === level);
  return threshold?.title || "Peasant";
}

function calculateLevel(xp: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= LEVEL_THRESHOLDS[i].xpRequired) {
      return LEVEL_THRESHOLDS[i].level;
    }
  }
  return 1;
}

// ─── Initial achievements ─────────────────────────────────────────────────────

const INITIAL_ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_loan",
    title: "First Steps",
    description: "Request your first loan",
    icon: "🎯",
    progress: 0,
    maxProgress: 1,
  },
  {
    id: "first_repayment",
    title: "Trustworthy",
    description: "Make your first loan repayment",
    icon: "💰",
    progress: 0,
    maxProgress: 1,
  },
  {
    id: "perfect_score",
    title: "Credit Master",
    description: "Reach a credit score of 800+",
    icon: "⭐",
    progress: 0,
    maxProgress: 800,
  },
  {
    id: "five_loans",
    title: "Experienced Borrower",
    description: "Complete 5 loans successfully",
    icon: "🏆",
    progress: 0,
    maxProgress: 5,
  },
  {
    id: "early_bird",
    title: "Early Bird",
    description: "Repay a loan before the due date",
    icon: "🐦",
    progress: 0,
    maxProgress: 1,
  },
  {
    id: "streak_master",
    title: "Streak Master",
    description: "Maintain a 10-payment streak",
    icon: "🔥",
    progress: 0,
    maxProgress: 10,
  },
];

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: GamificationState = {
  level: 1,
  xp: 0,
  kingdomTitle: "Peasant",
  achievements: INITIAL_ACHIEVEMENTS,
  soundEnabled: true,
  animationsEnabled: true,
  soundVolume: 0.5,
  showLevelUpModal: false,
  pendingLevelUp: null,
  recentXPGain: null,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGamificationStore = create<GamificationStore>()(
  devtools(
    persist(
      (set, get) => ({
        ...initialState,

        addXP: (amount, reason) => {
          const currentXP = get().xp;
          const newXP = currentXP + amount;

          set(
            {
              xp: newXP,
              recentXPGain: { amount, reason: reason || "", id: Date.now() },
            },
            false,
            `gamification/addXP:${reason || "unknown"}`,
          );

          // Check for level up
          get().checkLevelUp();
        },

        clearRecentXPGain: () =>
          set({ recentXPGain: null }, false, "gamification/clearRecentXPGain"),

        setLevel: (level) => {
          const kingdomTitle = getKingdomTitle(level);
          set({ level, kingdomTitle }, false, "gamification/setLevel");
        },

        checkLevelUp: () => {
          const { xp, level } = get();
          const newLevel = calculateLevel(xp);

          if (newLevel > level) {
            const levelUpReward = LEVEL_THRESHOLDS.find((t) => t.level === newLevel);
            if (levelUpReward) {
              set(
                {
                  level: newLevel,
                  kingdomTitle: levelUpReward.title,
                  showLevelUpModal: true,
                  pendingLevelUp: levelUpReward,
                },
                false,
                "gamification/levelUp",
              );
            }
          }
        },

        dismissLevelUp: () => {
          set(
            { showLevelUpModal: false, pendingLevelUp: null },
            false,
            "gamification/dismissLevelUp",
          );
        },

        unlockAchievement: (achievementId) => {
          set(
            (state) => ({
              achievements: state.achievements.map((a) =>
                a.id === achievementId
                  ? { ...a, unlockedAt: new Date().toISOString(), progress: a.maxProgress }
                  : a,
              ),
            }),
            false,
            `gamification/unlockAchievement:${achievementId}`,
          );
        },

        updateAchievementProgress: (achievementId, progress) => {
          set(
            (state) => ({
              achievements: state.achievements.map((a) => {
                if (a.id === achievementId) {
                  const newProgress = Math.min(progress, a.maxProgress || progress);
                  const isUnlocked = newProgress >= (a.maxProgress || 1);
                  return {
                    ...a,
                    progress: newProgress,
                    unlockedAt:
                      isUnlocked && !a.unlockedAt ? new Date().toISOString() : a.unlockedAt,
                  };
                }
                return a;
              }),
            }),
            false,
            `gamification/updateProgress:${achievementId}`,
          );
        },

        toggleSound: () => {
          set(
            (state) => ({ soundEnabled: !state.soundEnabled }),
            false,
            "gamification/toggleSound",
          );
        },

        toggleAnimations: () => {
          set(
            (state) => ({ animationsEnabled: !state.animationsEnabled }),
            false,
            "gamification/toggleAnimations",
          );
        },

        setSoundVolume: (volume) => {
          set({ soundVolume: Math.max(0, Math.min(1, volume)) }, false, "gamification/setVolume");
        },

        resetGamification: () => {
          set({ ...initialState }, false, "gamification/reset");
        },
      }),
      {
        name: "remitlend-gamification",
      },
    ),
    { name: "GamificationStore" },
  ),
);

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectLevel = (state: GamificationStore) => state.level;
export const selectXP = (state: GamificationStore) => state.xp;
export const selectKingdomTitle = (state: GamificationStore) => state.kingdomTitle;
export const selectAchievements = (state: GamificationStore) => state.achievements;
export const selectSoundEnabled = (state: GamificationStore) => state.soundEnabled;
export const selectAnimationsEnabled = (state: GamificationStore) => state.animationsEnabled;
export const selectSoundVolume = (state: GamificationStore) => state.soundVolume;
export const selectShowLevelUpModal = (state: GamificationStore) => state.showLevelUpModal;
export const selectPendingLevelUp = (state: GamificationStore) => state.pendingLevelUp;

// ─── Helper functions ─────────────────────────────────────────────────────────

export function getNextLevelInfo(currentXP: number): {
  currentLevel: number;
  nextLevel: number;
  xpToNext: number;
  progress: number;
} {
  const currentLevel = calculateLevel(currentXP);
  const nextLevelThreshold = LEVEL_THRESHOLDS.find((t) => t.level === currentLevel + 1);
  const currentLevelThreshold = LEVEL_THRESHOLDS.find((t) => t.level === currentLevel);

  if (!nextLevelThreshold) {
    return {
      currentLevel,
      nextLevel: currentLevel,
      xpToNext: 0,
      progress: 100,
    };
  }

  const xpInCurrentLevel = currentXP - (currentLevelThreshold?.xpRequired || 0);
  const xpNeededForNextLevel =
    nextLevelThreshold.xpRequired - (currentLevelThreshold?.xpRequired || 0);
  const progress = (xpInCurrentLevel / xpNeededForNextLevel) * 100;

  return {
    currentLevel,
    nextLevel: nextLevelThreshold.level,
    xpToNext: nextLevelThreshold.xpRequired - currentXP,
    progress: Math.min(100, Math.max(0, progress)),
  };
}

export { LEVEL_THRESHOLDS };
