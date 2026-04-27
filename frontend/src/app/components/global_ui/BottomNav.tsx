"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  HandCoins,
  PiggyBank,
  SendHorizontal,
  User,
  Clock,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useLocale } from "next-intl";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Loans", href: "/loans", icon: HandCoins },
  { name: "Lend", href: "/lend", icon: PiggyBank },
  { name: "Activity", href: "/activity", icon: Clock },
  { name: "Profile", href: "/profile", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const locale = useLocale();

  // Normalize pathname to handle locale prefix
  const getHref = (href: string) => `/${locale}${href === "/" ? "" : href}`;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:hidden"
    >
      <div className="flex items-center justify-around px-2 py-2">
        {navItems.map((item) => {
          const isActive = pathname === `/${locale}${item.href}` || 
            (item.href !== "/" && pathname.startsWith(`/${locale}${item.href}`));
          
          return (
            <Link
              key={item.name}
              href={getHref(item.href)}
              className={cn(
                "flex flex-col items-center justify-center rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30"
                  : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              )}
              aria-current={isActive ? "page" : undefined}
            >
              <item.icon
                className={cn("h-5 w-5 mb-1", isActive && "text-indigo-600 dark:text-indigo-400")}
                aria-hidden="true"
              />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}