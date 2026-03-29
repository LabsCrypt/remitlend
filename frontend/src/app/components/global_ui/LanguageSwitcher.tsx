"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, useTransition } from "react";
import { Languages } from "lucide-react";

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  function onSelectChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextLocale = event.target.value;
    startTransition(() => {
      // replace the locale in the pathname
      const segments = pathname.split("/");
      segments[1] = nextLocale;
      router.replace(segments.join("/"));
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
