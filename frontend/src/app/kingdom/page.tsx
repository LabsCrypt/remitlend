"use client";

import { KingdomProgressWidget } from "../components/gamification/KingdomProgressWidget";
import { AchievementsPanel } from "../components/gamification/AchievementsPanel";
import { GamificationSettings } from "../components/gamification/GamificationSettings";
import { useGamificationStore } from "../stores/useGamificationStore";
import { Card } from "../components/ui/Card";
import { Crown } from "lucide-react";

export default function KingdomPage() {
  const level = useGamificationStore((state) => state.level);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);

  return (
    <main className="min-h-screen p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header>
        <div className="flex items-center gap-3 mb-2">
          <Crown className="h-8 w-8 text-purple-600 dark:text-purple-400" />
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Kingdom Dashboard</h1>
        </div>
        <p className="text-zinc-500 dark:text-zinc-400">
          Track your progress, unlock achievements, and rise through the ranks
        </p>
      </header>

      {/* Welcome card */}
      <Card className="bg-gradient-to-br from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-purple-200 dark:border-purple-800">
        <div className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                Welcome, {kingdomTitle}!
              </h2>
              <p className="text-purple-700 dark:text-purple-300 mt-1">
                You are currently at Level {level}
              </p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg">
              <Crown size={32} className="text-white" />
            </div>
          </div>
        </div>
      </Card>

      {/* Progress widget */}
      <KingdomProgressWidget />

      {/* Achievements */}
      <AchievementsPanel />

      {/* Settings */}
      <GamificationSettings />
    </main>
  );
}
