"use client";

import { Crown } from "lucide-react";
import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useTranslations } from "next-intl";
import { useGamificationStore } from "../../stores/useGamificationStore";
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
  () =>
    import("../../components/gamification/AchievementsPanel").then(
      (m) => m.AchievementsPanel,
    ),
  { ssr: false, loading: () => <AchievementsSkeleton /> },
);

const GamificationSettings = dynamic(
  () =>
    import("../../components/gamification/GamificationSettings").then(
      (m) => m.GamificationSettings,
    ),
  { ssr: false, loading: () => <SkeletonCard /> },
);

export default function KingdomPage() {
  const t = useTranslations("Kingdom");
  const level = useGamificationStore((state) => state.level);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);

  return (
    <main className="min-h-screen p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header>
        <div className="flex items-center gap-3 mb-2">
          <Crown className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
        </div>
        <p className="text-zinc-500 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>

      {/* Welcome card */}
      <Card
        className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-purple-200 dark:border-purple-800"
      >
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                {t("welcome", { kingdomTitle })}
              </h2>
              <p className="text-purple-700 dark:text-purple-300 mt-1">
                {t("level", { level })}
              </p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg">
              <Crown size={32} className="text-white" />
            </div>
          </div>
        </div>
      </Card>

      {/* Progress widget */}
      <Suspense fallback={<KingdomProgressSkeleton />}>
        <KingdomProgressWidget />
      </Suspense>

      {/* Achievements */}
      <Suspense fallback={<AchievementsSkeleton />}>
        <AchievementsPanel />
      </Suspense>

      {/* Settings */}
      <Suspense fallback={<SkeletonCard />}>
        <GamificationSettings />
      </Suspense>
    </main>
  );
}
