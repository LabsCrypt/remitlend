"use client";

import { useEffect, useState } from "react";
import { Bell, Menu, Search, User, Wallet, LogOut } from "lucide-react";
import { useWalletStore } from "../../stores/useWalletStore";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface HeaderProps {
  onMenuClick?: () => void;
  className?: string;
}

export function Header({ onMenuClick, className }: HeaderProps) {
  const { address, status, walletType, setConnected, disconnect } = useWalletStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Silent connect logic: App initialization checks if we have a persisted session
    if (address && walletType && status !== "connected") {
      setConnected(address, null, walletType);
    }
  }, [address, walletType, status, setConnected]);
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 sm:px-6 lg:px-8",
        className,
      )}
    >
      <div className="flex items-center gap-4 lg:gap-0">
        <button
          onClick={onMenuClick}
          className="p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 lg:hidden"
        >
          <Menu className="h-6 w-6" />
        </button>

        <div className="hidden lg:flex relative max-w-md">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-zinc-400" />
          </div>
          <input
            type="search"
            placeholder="Search loans, users..."
            className="block w-full rounded-full border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-3 text-sm placeholder-zinc-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {(!mounted || status !== "connected") ? (
          <>
            <button className="hidden sm:flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-500/20" onClick={() => setConnected("0x1234567890abcdef1234567890abcdef12345678", null, "injected")}>
              <Wallet className="h-4 w-4" />
              Connect Wallet
            </button>

            <button className="sm:hidden p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900" onClick={() => setConnected("0x1234567890abcdef1234567890abcdef12345678", null, "injected")}>
              <Wallet className="h-5 w-5 text-indigo-600" />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 sm:gap-4">
            <button className="flex items-center gap-2 rounded-full p-1 border border-zinc-200 hover:border-zinc-300 transition-colors dark:border-zinc-800 dark:hover:border-zinc-700">
              <div className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                <div className="h-full w-full bg-gradient-to-tr from-indigo-500 to-purple-500 opacity-80" />
              </div>
              <div className="hidden md:block pr-2">
                <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                  {address?.slice(0, 6)}...{address?.slice(-4)}
                </p>
              </div>
            </button>

            <button 
              onClick={() => disconnect()}
              className="flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors border border-red-200 dark:border-red-900/30"
              title="Disconnect Wallet"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Disconnect</span>
            </button>
          </div>
        )}

        <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

        <button className="relative p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
          <Bell className="h-5 w-5" />
          <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-indigo-500 border-2 border-white dark:border-zinc-950" />
        </button>
      </div>
      </div>
    </header>
  );
}
