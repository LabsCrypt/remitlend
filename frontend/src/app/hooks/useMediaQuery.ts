"use client";

import { useEffect, useState } from "react";

/**
 * SSR-safe `window.matchMedia` subscription.
 *
 * Returns `defaultValue` during server render and on the first client render,
 * then switches to the real value in an effect. That one-render mismatch is
 * deliberate: it avoids a hydration error, and every caller here is a
 * progressive enhancement (keyboard focus management, lazy mounting) rather
 * than something that changes layout on the first paint.
 *
 * Must be called with a static query string so the effect dependency is
 * stable.
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind's `lg` breakpoint. Kept here so it is defined exactly once. */
export const LG_BREAKPOINT_PX = 1024;

/**
 * True at Tailwind's `lg` width and above, where the Sidebar is docked rather
 * than drawn as an off-canvas drawer.
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(`(min-width: ${LG_BREAKPOINT_PX}px)`);
}
