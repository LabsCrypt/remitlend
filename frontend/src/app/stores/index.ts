/**
 * stores/index.ts
 *
 * Barrel export for all Zustand stores.
 * Import from here instead of individual store files.
 *
 * Usage:
 *   import { useUserStore, useWalletStore, useUIStore } from "@/app/stores"
 */

export {
  useUserStore,
  selectUser,
  selectIsAuthenticated,
  selectUserIsLoading,
  selectUserError,
} from "./useUserStore";
export type { User, UserStore } from "./useUserStore";

export {
  useWalletStore,
  selectWalletAddress,
  selectWalletStatus,
  selectIsWalletConnected,
  selectWalletNetwork,
  selectWalletBalances,
  selectWalletError,
} from "./useWalletStore";
export type { WalletStatus, WalletNetwork, TokenBalance, WalletStore } from "./useWalletStore";

export {
  useUIStore,
  selectModal,
  selectToasts,
  selectIsGlobalLoading,
  selectGlobalLoadingMessage,
} from "./useUIStore";
export type { Toast, ToastVariant, ModalId, UIStore } from "./useUIStore";

export {
  useGamificationStore,
  selectLevel,
  selectXP,
  selectKingdomTitle,
  selectAchievements,
  selectSoundEnabled,
  selectAnimationsEnabled,
  selectSoundVolume,
  selectShowLevelUpModal,
  selectPendingLevelUp,
  getNextLevelInfo,
  LEVEL_THRESHOLDS,
} from "./useGamificationStore";
export type {
  KingdomLevel,
  Achievement,
  LevelUpReward,
  GamificationStore,
} from "./useGamificationStore";

export { useThemeStore, selectTheme, selectThemeHydrated } from "./useThemeStore";
export { THEME_STORAGE_KEY } from "../lib/theme";
export type { ThemeStore } from "./useThemeStore";
export type { Theme } from "../lib/theme";
