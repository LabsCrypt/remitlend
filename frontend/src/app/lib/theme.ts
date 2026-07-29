export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "remitlend-theme";

export function getSystemTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") {
    return null;
  }
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return storedTheme === "dark" || storedTheme === "light" || storedTheme === "system"
    ? (storedTheme as Theme)
    : null;
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (theme === "system") {
    const resolved = getSystemTheme();
    root.dataset.theme = "system";
    root.classList.toggle("dark", resolved === "dark");
  } else {
    root.dataset.theme = theme;
    root.classList.toggle("dark", theme === "dark");
  }
}

export function resolveInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const presetTheme = document.documentElement.dataset.theme;
    if (presetTheme === "dark" || presetTheme === "light" || presetTheme === "system") {
      return presetTheme as Theme;
    }
  }
  return getStoredTheme() ?? getSystemTheme();
}
