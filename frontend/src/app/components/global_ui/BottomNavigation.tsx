"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  HandCoins,
  ArrowDownLeft,
  CreditCard,
  MoreHorizontal,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const navItems = [
  { name: "Home", href: "/", icon: LayoutDashboard },
  { name: "Loans", href: "/loans", icon: HandCoins },
  { name: "Repay", href: "/repay", icon: ArrowDownLeft },
  { name: "Wallet", href: "/wallet", icon: CreditCard },
  { name: "More", href: "/more", icon: MoreHorizontal },
];

export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-zinc-200 dark:border-zinc-800 dark:bg-zinc-950 md:hidden">
      <div className="flex items-center justify-around h-16 px-1 sm:px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-1 px-1 sm:px-2 rounded-lg transition-colors min-w-0 flex-1",
                isActive
                  ? "text-indigo-600 dark:text-indigo-400"
                  : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300",
              )}
            >
              <item.icon
                className={cn(
                  "h-4 w-4 sm:h-5 sm:w-5",
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-500 dark:text-zinc-400",
                )}
              />
              <span className="text-xs font-medium truncate">
                {item.name}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
