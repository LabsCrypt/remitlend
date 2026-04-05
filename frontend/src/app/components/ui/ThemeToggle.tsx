"use client";

import { useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useThemeStore } from "../../stores/useThemeStore";

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const hydrated = useThemeStore((state) => state.hydrated);
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);

  useEffect(() => {
    if (!hydrated) {
      initializeTheme();
    }
  }, [hydrated, initializeTheme]);

  // Prevent hydration mismatch and flash of unstyled icon
  if (!hydrated) {
    return (
      <button className="p-2 text-transparent" aria-hidden="true" disabled>
        <div className="h-5 w-5" />
      </button>
    );
  }

  const Icon = theme === "dark" ? Moon : Sun;
  const label = theme === "dark" ? "Dark mode" : "Light mode";
  const nextLabel = theme === "dark" ? "light" : "dark";

  return (
    <button
      onClick={toggleTheme}
      className="p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 rounded-lg transition-colors"
      aria-label={`${label} active, switch to ${nextLabel} mode`}
      aria-live="polite"
      title={label}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
