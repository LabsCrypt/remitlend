"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, useTransition } from "react";
import { Languages } from "lucide-react";

export const SUPPORTED_LOCALES = ["en", "es", "tl"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Replaces the locale segment of a pathname while preserving the rest of the route,
 * including nested segments, query-free path structure, and trailing slashes.
 * Returns null when the requested locale is unsupported.
 */
export function buildLocalizedPath(pathname: string, nextLocale: string): string | null {
  if (!isSupportedLocale(nextLocale)) {
    return null;
  }
  const segments = pathname.split("/");
  segments[1] = nextLocale;
  return segments.join("/");
}

/**
 * Persists the selected locale so it survives navigation and reloads.
 */
export function persistLocale(locale: string): void {
  if (!isSupportedLocale(locale)) {
    return;
  }
  try {
    window.localStorage.setItem("preferred-locale", locale);
  } catch {
    // Storage may be unavailable (e.g. private mode); ignore.
  }
}

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function onSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value;
    const targetPath = buildLocalizedPath(pathname, nextLocale);
    if (targetPath === null) {
      return;
    }
    persistLocale(nextLocale);
    startTransition(() => {
      router.replace(targetPath);
    });
  }

  return (
    <div className="relative flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 hover:border-zinc-300 transition-colors dark:border-zinc-800 dark:hover:border-zinc-700">
      <Languages className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
      <select
        defaultValue={locale}
        disabled={isPending}
        onChange={onSelectChange}
        className="bg-transparent text-sm font-medium text-zinc-900 focus:outline-none dark:text-zinc-50 appearance-none cursor-pointer"
      >
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="tl">Tagalog</option>
      </select>
    </div>
  );
}
