import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { THEME_STORAGE_KEY, type Theme } from "../lib/theme";

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

function getSystemTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") {
    return null;
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" ? storedTheme : null;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
}

function resolveInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const presetTheme = document.documentElement.dataset.theme;
    if (presetTheme === "dark" || presetTheme === "light") {
      return presetTheme;
    }
  }

  return getStoredTheme() ?? getSystemTheme();
}

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
          if (getStoredTheme() !== null) {
            return;
          }

          const nextTheme = mediaQuery.matches ? "dark" : "light";
          applyTheme(nextTheme);
          set({ theme: nextTheme }, false, "theme/syncSystemTheme");
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
        const nextTheme = get().theme === "dark" ? "light" : "dark";
        get().setTheme(nextTheme);
      },
    }),
    { name: "ThemeStore" },
  ),
);

export const selectTheme = (state: ThemeStore) => state.theme;
export const selectThemeHydrated = (state: ThemeStore) => state.hydrated;
