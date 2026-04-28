"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  HandCoins,
  PiggyBank,
  SendHorizontal,
  Settings,
  X,
  CreditCard,
  Clock,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useTranslations, useLocale } from "next-intl";
import {
  useWalletStore,
  selectWalletStatus,
  selectWalletNetwork,
} from "../../stores/useWalletStore";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface SidebarProps {
  onClose?: () => void;
  className?: string;
}

export function Sidebar({ onClose, className }: SidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("Navigation");
  const locale = useLocale();

  const status = useWalletStore(selectWalletStatus);
  const network = useWalletStore(selectWalletNetwork);
  const isConnected = status === "connected";

  const navItems = [
    { name: t("home"), href: `/${locale}`, icon: LayoutDashboard },
    { name: t("loans"), href: `/${locale}/loans`, icon: HandCoins },
    { name: "Lend", href: `/${locale}/lend`, icon: PiggyBank },
    { name: t("activity"), href: `/${locale}/activity`, icon: Clock },
    { name: "Wallet", href: `/${locale}/wallet`, icon: CreditCard },
  ];

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        "flex h-full w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
        className,
      )}
    >
      <div className="flex h-16 items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800">
        <Link href={`/${locale}`} className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <SendHorizontal className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            RemitLend
          </span>
        </Link>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 lg:hidden rounded-lg"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-4 overflow-y-auto" aria-label="Site navigation">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
              )}
            >
              <item.icon
                aria-hidden="true"
                className={cn(
                  "h-5 w-5",
                  isActive
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-zinc-400 dark:text-zinc-500",
                )}
              />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
        <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Wallet Status
          </p>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                isConnected ? "bg-green-500" : "bg-zinc-300 dark:bg-zinc-700",
              )}
            />
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
              {isConnected ? `${network?.name || "Connected"}` : "Disconnected"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
