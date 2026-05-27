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
  return storedTheme === "dark" || storedTheme === "light" || storedTheme === "system"
    ? (storedTheme as Theme)
    : null;
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  if (theme === "system") {
    // set dataset to 'system' but apply the resolved system appearance
    const resolved = getSystemTheme();
    root.dataset.theme = "system";
    root.classList.toggle("dark", resolved === "dark");
  } else {
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
  }
}

function resolveInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const presetTheme = document.documentElement.dataset.theme;
    if (presetTheme === "dark" || presetTheme === "light" || presetTheme === "system") {
      return presetTheme as Theme;
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
          const stored = getStoredTheme();
          // If user has an explicit stored preference that is not 'system', do nothing.
          if (stored !== null && stored !== "system") return;

          const nextTheme = mediaQuery.matches ? "dark" : "light";
          // When stored === 'system' or no stored value, keep store.theme as 'system' or resolved
          applyTheme(stored === "system" ? "system" : nextTheme);
          // If stored === 'system', keep state.theme as 'system', else set resolved theme
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
