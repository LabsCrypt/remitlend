"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
    LayoutDashboard,
    HandCoins,
    SendHorizontal,
    Settings,
    X,
    CreditCard
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface SidebarProps {
    onClose?: () => void;
    className?: string;
}

const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Loans", href: "/loans", icon: HandCoins },
    { name: "Remittances", href: "/remittances", icon: SendHorizontal },
    { name: "Wallet", href: "/wallet", icon: CreditCard },
    { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ onClose, className }: SidebarProps) {
    const pathname = usePathname();

    return (
        <aside
            className={cn(
                "flex h-full w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950",
                className
            )}
        >
            <div className="flex h-16 items-center justify-between px-6 border-b border-zinc-200 dark:border-zinc-800">
                <Link href="/" className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                        <SendHorizontal className="h-5 w-5 text-white" />
                    </div>
                    <span className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                        RemitLend
                    </span>
                </Link>
                {onClose && (
                    <button
                        onClick={onClose}
                        className="p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 lg:hidden"
                    >
                        <X className="h-5 w-5" />
                    </button>
                )}
            </div>

            <nav className="flex-1 space-y-1 p-4 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
                                    : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
                            )}
                        >
                            <item.icon className={cn("h-5 w-5", isActive ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-400 dark:text-zinc-500")} />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
                <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
                    <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                        System Status
                    </p>
                    <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full bg-green-500" />
                        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">Mainnet Connected</span>
                    </div>
                </div>
            </div>
        </aside>
    );
}
