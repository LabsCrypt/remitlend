"use client";

import { Bell, Menu, Search, User, Wallet } from "lucide-react";
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
    return (
        <header
            className={cn(
                "sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 sm:px-6 lg:px-8",
                className
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
                <button className="hidden sm:flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-500/20">
                    <Wallet className="h-4 w-4" />
                    Connect Wallet
                </button>

                <button className="sm:hidden p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
                    <Wallet className="h-5 w-5 text-indigo-600" />
                </button>

                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

                <button className="relative p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
                    <Bell className="h-5 w-5" />
                    <span className="absolute top-1.5 right-1.5 flex h-2 w-2 rounded-full bg-indigo-500 border-2 border-white dark:border-zinc-950" />
                </button>

                <button className="flex items-center gap-2 rounded-full p-1 border border-zinc-200 hover:border-zinc-300 transition-colors dark:border-zinc-800 dark:hover:border-zinc-700">
                    <div className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        <User className="h-4 w-4 text-zinc-500 dark:text-zinc-400" />
                    </div>
                    <div className="hidden md:block pr-2">
                        <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">John Doe</p>
                    </div>
                </button>
            </div>
        </header>
    );
}
