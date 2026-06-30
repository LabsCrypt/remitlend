"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  BadgeCheck,
  Crown,
  FileText,
  SendHorizontal,
  TimerReset,
} from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useGamificationStore } from "../../stores/useGamificationStore";
import {
  selectWalletAddress,
  selectIsWalletConnected,
  useWalletStore,
} from "../../stores/useWalletStore";
import { useRemittanceNft } from "../../hooks/useApi";
import { Card } from "../../components/ui/Card";
import { SkeletonCard } from "../../components/ui/Skeleton";
import { AchievementsSkeleton } from "../../components/skeletons/AchievementsSkeleton";
import { KingdomProgressSkeleton } from "../../components/skeletons/KingdomProgressSkeleton";

const KingdomProgressWidget = dynamic(
  () =>
    import("../../components/gamification/KingdomProgressWidget").then(
      (m) => m.KingdomProgressWidget,
    ),
  { ssr: false, loading: () => <KingdomProgressSkeleton /> },
);

const AchievementsPanel = dynamic(
  () => import("../../components/gamification/AchievementsPanel").then((m) => m.AchievementsPanel),
  { ssr: false, loading: () => <AchievementsSkeleton /> },
);

const GamificationSettings = dynamic(
  () =>
    import("../../components/gamification/GamificationSettings").then(
      (m) => m.GamificationSettings,
    ),
  { ssr: false, loading: () => <SkeletonCard /> },
);

export default function KingdomClient() {
  const t = useTranslations("Kingdom");
  const locale = useLocale();
  const level = useGamificationStore((state) => state.level);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);
  const address = useWalletStore(selectWalletAddress);
  const isConnected = useWalletStore(selectIsWalletConnected);
  const {
    data: nft,
    isLoading: isNftLoading,
    isError: isNftError,
  } = useRemittanceNft(address ?? undefined, { enabled: isConnected && Boolean(address) });

  return (
    <main className="min-h-screen p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      <header>
        <div className="flex items-center gap-3 mb-2">
          <Crown className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        </div>
        <p className="text-zinc-500 dark:text-zinc-400">{t("description")}</p>
      </header>

      <Card className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-purple-200 dark:border-purple-800">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                {t("welcome", { kingdomTitle })}
              </h2>
              <p className="text-purple-700 dark:text-purple-300 mt-1">{t("level", { level })}</p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg">
              <Crown size={32} className="text-white" />
            </div>
          </div>
        </div>
      </Card>

      <Suspense fallback={<KingdomProgressSkeleton />}>
        <KingdomProgressWidget />
      </Suspense>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-200/40 dark:border-zinc-800 dark:bg-zinc-950 dark:shadow-none">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400">
              {t("nft.eyebrow")}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {t("nft.title")}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              {t("nft.description")}
            </p>
          </div>
          <div className="rounded-xl bg-zinc-100 p-3 text-indigo-600 dark:bg-zinc-900 dark:text-indigo-300">
            <BadgeCheck className="h-6 w-6" />
          </div>
        </div>

        {!isConnected ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {t("nft.connectTitle")}
            </p>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              {t("nft.connectDescription")}
            </p>
          </div>
        ) : isNftLoading ? (
          <SkeletonCard />
        ) : isNftError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
            {t("nft.error")}
          </div>
        ) : !nft ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
            <div className="rounded-xl bg-zinc-100 p-3 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <FileText className="h-7 w-7" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {t("nft.emptyTitle")}
              </h3>
              <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                {t("nft.emptyDescription")}
              </p>
            </div>
            <Link
              href={`/${locale}/send-remittance`}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
            >
              <SendHorizontal className="h-4 w-4" />
              {t("nft.emptyAction")}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("nft.score")}</p>
              <p className="mt-2 text-5xl font-bold text-zinc-900 dark:text-zinc-50">{nft.score}</p>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
                {t("nft.historyHash")}
              </p>
              <p className="mt-1 break-all rounded-lg bg-zinc-50 p-3 font-mono text-xs text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {nft.historyHash || t("nft.notAvailable")}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: t("nft.defaultCount"), value: nft.defaultCount, icon: BadgeCheck },
                {
                  label: t("nft.cooldownRemaining"),
                  value: t("nft.ledgers", { count: nft.transferCooldownRemaining }),
                  icon: TimerReset,
                },
                {
                  label: t("nft.lastUpdateLedger"),
                  value: nft.lastUpdateLedger || t("nft.notAvailable"),
                  icon: FileText,
                },
              ].map((item) => (
                <article
                  key={item.label}
                  className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <item.icon className="mb-3 h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">{item.label}</p>
                  <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    {item.value}
                  </p>
                </article>
              ))}
              <a
                href={nft.metadataUri || undefined}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border border-zinc-200 p-4 transition hover:border-indigo-300 hover:bg-indigo-50/60 dark:border-zinc-800 dark:hover:border-indigo-700 dark:hover:bg-indigo-950/20 sm:col-span-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      {t("nft.metadataUri")}
                    </p>
                    <p className="mt-1 truncate font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      {nft.metadataUri || t("nft.notAvailable")}
                    </p>
                  </div>
                  <ArrowUpRight className="h-5 w-5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                </div>
              </a>
            </div>
          </div>
        )}
      </section>

      <Suspense fallback={<AchievementsSkeleton />}>
        <AchievementsPanel />
      </Suspense>

      <Suspense fallback={<SkeletonCard />}>
        <GamificationSettings />
      </Suspense>
    </main>
  );
}
