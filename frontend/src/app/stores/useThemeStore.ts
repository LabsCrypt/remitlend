import { create } from "zustand";
import { devtools } from "zustand/middleware";
import {
  THEME_STORAGE_KEY,
  type Theme,
  getSystemTheme,
  getStoredTheme,
  applyTheme,
  resolveInitialTheme,
} from "../lib/theme";

interface ThemeState {
  theme: Theme;
  hydrated: boolean;
}

interface ThemeActions {
  initializeTheme: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export type ThemeStore = ThemeState & ThemeActions;

let hasAttachedSystemThemeListener = false;

export const useThemeStore = create<ThemeStore>()(
  devtools(
    (set, get) => ({
      theme: "light",
      hydrated: false,

      initializeTheme: () => {
        const theme = resolveInitialTheme();
        applyTheme(theme);
        set({ theme, hydrated: true }, false, "theme/initializeTheme");

        if (typeof window === "undefined" || hasAttachedSystemThemeListener) {
          return;
        }

        hasAttachedSystemThemeListener = true;
        const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        const handleSystemThemeChange = () => {
          const stored = getStoredTheme();
          if (stored !== null && stored !== "system") return;

          const nextTheme = mediaQuery.matches ? "dark" : "light";
          applyTheme(stored === "system" ? "system" : nextTheme);
          set(
            { theme: stored === "system" ? "system" : nextTheme },
            false,
            "theme/syncSystemTheme",
          );
        };

        mediaQuery.addEventListener("change", handleSystemThemeChange);
      },

      setTheme: (theme) => {
        applyTheme(theme);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(THEME_STORAGE_KEY, theme);
        }
        set({ theme, hydrated: true }, false, "theme/setTheme");
      },

      toggleTheme: () => {
        const current = get().theme;
        const nextTheme = current === "light" ? "dark" : current === "dark" ? "system" : "light";
        get().setTheme(nextTheme);
      },
    }),
    { name: "ThemeStore" },
  ),
);

export const selectTheme = (state: ThemeStore) => state.theme;
export const selectThemeHydrated = (state: ThemeStore) => state.hydrated;
