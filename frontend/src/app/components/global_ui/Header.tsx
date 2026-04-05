"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { Menu, Search, User, Wallet } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ThemeToggle } from "../ui/ThemeToggle";
import { NotificationDropdown } from "./NotificationDropdown";
import { useWalletStore } from "../../stores/useWalletStore";
import { useUserStore } from "../../stores/useUserStore";
import { useGamificationStore } from "../../stores/useGamificationStore";
import { useWallet } from "../providers/WalletProvider";
import { useLoans, useRemittances } from "../../hooks/useApi";
import { useContractToast } from "../../hooks/useContractToast";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useTranslations, useLocale } from "next-intl";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function truncateWalletAddress(address: string) {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

interface HeaderProps {
  onMenuClick?: () => void;
  className?: string;
}

export function Header({ onMenuClick, className }: HeaderProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Navigation");
  const isConnected = useWalletStore((state) => state.status === "connected");
  const walletAddress = useWalletStore((state) => state.address);
  const { connectWallet, disconnectWallet } = useWallet();
  const user = useUserStore((state) => state.user);
  const gamificationStore = useGamificationStore();
  const toast = useContractToast();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: loans = [] } = useLoans({ enabled: isConnected });
  const { data: remittances = [] } = useRemittances({ enabled: isConnected });

  const pages = useMemo(
    () => [
      { name: t("dashboard"), href: `/${locale}` },
      { name: t("loans"), href: `/${locale}/loans` },
      { name: "Remittances", href: `/${locale}/remittances` },
      { name: "Lend", href: `/${locale}/lend` },
      { name: "Analytics", href: `/${locale}/analytics` },
      { name: "Wallet", href: `/${locale}/wallet` },
      { name: "Settings", href: `/${locale}/settings` },
    ],
    [locale, t],
  );

  const searchResults = useMemo(() => {
    const term = debouncedQuery.trim().toLowerCase();
    if (!term) {
      return [] as {
        id: string;
        title: string;
        subtitle: string;
        category: "Loans" | "Pages" | "Transactions";
        href: string;
      }[];
    }

    const loanResults = loans
      .filter(
        (loan) =>
          loan.id.toString().toLowerCase().includes(term) ||
          loan.borrowerId.toLowerCase().includes(term),
      )
      .slice(0, 5)
      .map((loan) => ({
        id: `loan-${loan.id}`,
        title: `Loan #${loan.id}`,
        subtitle: loan.borrowerId,
        category: "Loans" as const,
        href: `/${locale}/loans/${loan.id}`,
      }));

    const pageResults = pages
      .filter(
        (page) => page.name.toLowerCase().includes(term) || page.href.toLowerCase().includes(term),
      )
      .slice(0, 5)
      .map((page) => ({
        id: `page-${page.href}`,
        title: page.name,
        subtitle: page.href,
        category: "Pages" as const,
        href: page.href,
      }));

    const transactionResults = remittances
      .filter((remittance) => remittance.id.toLowerCase().includes(term))
      .slice(0, 5)
      .map((remittance) => ({
        id: `tx-${remittance.id}`,
        title: `Tx ${remittance.id.slice(0, 10)}...`,
        subtitle: `${remittance.amount} ${remittance.fromCurrency} to ${remittance.toCurrency}`,
        category: "Transactions" as const,
        href: `/${locale}/remittances`,
      }));

    return [...loanResults, ...pageResults, ...transactionResults];
  }, [debouncedQuery, loans, pages, remittances, locale]);

  const groupedResults = useMemo(() => {
    const categories: Array<"Loans" | "Pages" | "Transactions"> = [
      "Loans",
      "Pages",
      "Transactions",
    ];
    return categories
      .map((category) => ({
        category,
        items: searchResults.filter((item) => item.category === category),
      }))
      .filter((group) => group.items.length > 0);
  }, [searchResults]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsOpen(true);
        inputRef.current?.focus();
      }
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const handleSelect = (href: string) => {
    setIsOpen(false);
    setQuery("");
    setDebouncedQuery("");
    router.push(href);
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) =>
        searchResults.length === 0 ? 0 : (prev + 1) % searchResults.length,
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        searchResults.length === 0 ? 0 : (prev - 1 + searchResults.length) % searchResults.length,
      );
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const selected = searchResults[activeIndex];
      if (selected) {
        handleSelect(selected.href);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const handleWalletToggle = async () => {
    if (isConnected) {
      disconnectWallet();
      toast.info("Wallet disconnected", "Reconnect anytime to continue borrowing and lending.");
      return;
    }

    try {
      await connectWallet();
      gamificationStore.addXP(10, "Wallet connection");
      toast.success("Wallet connected");
    } catch (error) {
      toast.error(
        "Wallet connection failed",
        error instanceof Error ? error.message : "Unable to connect to Freighter.",
      );
    }
  };

  const profileLabel = user?.email
    ? user.email
    : user?.walletAddress
      ? truncateWalletAddress(user.walletAddress)
      : walletAddress
        ? truncateWalletAddress(walletAddress)
        : "Connect Wallet";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 sm:px-6 lg:px-8",
        className,
      )}
    >
      <div className="flex items-center gap-4 lg:gap-0">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          aria-haspopup="true"
          className="p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 lg:hidden rounded-lg"
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </button>

        <div ref={wrapperRef} className="relative hidden lg:flex w-full max-w-xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          </div>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIsOpen(true);
              setActiveIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleInputKeyDown}
            placeholder="Search loans, pages, transactions…"
            aria-label="Search loans, pages, and transactions"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-controls="header-search-results"
            aria-activedescendant={
              isOpen && searchResults[activeIndex]
                ? `search-result-${searchResults[activeIndex].id}`
                : undefined
            }
            className="block w-full rounded-full border border-zinc-200 bg-zinc-50 py-2 pl-10 pr-3 text-sm placeholder-zinc-500 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 hidden items-center text-xs text-zinc-400 xl:flex">
            Ctrl/Cmd + K
          </span>

          {isOpen && (
            <div
              id="header-search-results"
              role="listbox"
              className="absolute top-12 z-40 max-h-[26rem] w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-200/50 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none"
            >
              {debouncedQuery.trim().length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  Type to search loans, pages, and transaction hashes.
                </p>
              ) : searchResults.length === 0 ? (
                <p className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400">
                  No results found
                </p>
              ) : (
                groupedResults.map((group) => (
                  <div key={group.category} className="mb-2 last:mb-0">
                    <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      {group.category}
                    </p>
                    {group.items.map((item) => {
                      const globalIndex = searchResults.findIndex(
                        (result) => result.id === item.id,
                      );
                      const isActive = globalIndex === activeIndex;
                      return (
                        <button
                          key={item.id}
                          id={`search-result-${item.id}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => handleSelect(item.href)}
                          className={cn(
                            "flex w-full items-start justify-between rounded-xl px-3 py-2 text-left transition",
                            isActive
                              ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300"
                              : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900",
                          )}
                        >
                          <span className="text-sm font-medium">{item.title}</span>
                          <span className="ml-3 text-xs text-zinc-500 dark:text-zinc-400">
                            {item.subtitle}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <div className="hidden sm:block">
          <LanguageSwitcher />
        </div>

        <button
          type="button"
          onClick={handleWalletToggle}
          aria-label={isConnected ? "Disconnect wallet" : "Connect wallet"}
          className="hidden sm:flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-all shadow-sm shadow-indigo-500/20"
        >
          <Wallet className="h-4 w-4" aria-hidden="true" />
          {isConnected && walletAddress ? truncateWalletAddress(walletAddress) : "Connect Wallet"}
        </button>

        <button
          type="button"
          onClick={handleWalletToggle}
          aria-label={isConnected ? "Disconnect wallet" : "Connect wallet"}
          className="sm:hidden p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900 rounded-lg"
        >
          <Wallet className="h-5 w-5 text-indigo-600" aria-hidden="true" />
        </button>

        <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

        <ThemeToggle />

        <NotificationDropdown />

        <button
          type="button"
          aria-label={`Profile: ${profileLabel}`}
          className="flex items-center gap-2 rounded-full p-1 border border-zinc-200 hover:border-zinc-300 transition-colors dark:border-zinc-800 dark:hover:border-zinc-700"
        >
          <div className="h-7 w-7 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            <User className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
          </div>
          <div className="hidden md:block pr-2">
            <p className="text-xs font-semibold text-zinc-900 dark:text-zinc-50" aria-hidden="true">
              {profileLabel}
            </p>
          </div>
        </button>
      </div>
    </header>
  );
}
