"use client";

import { useState } from "react";
import { KingdomProgressWidget } from "../components/gamification/KingdomProgressWidget";
import { AchievementsPanel } from "../components/gamification/AchievementsPanel";
import { GamificationSettings } from "../components/gamification/GamificationSettings";
import { LevelUpModal } from "../components/gamification/LevelUpModal";
import { XPGainAnimation } from "../components/gamification/XPGainAnimation";
import { useGamificationStore } from "../stores/useGamificationStore";
import { useSoundEffect } from "../utils/soundManager";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Crown, Sparkles, Gift, Target } from "lucide-react";

export default function KingdomPage() {
  const addXP = useGamificationStore((state) => state.addXP);
  const unlockAchievement = useGamificationStore((state) => state.unlockAchievement);
  const soundEnabled = useGamificationStore((state) => state.soundEnabled);
  const level = useGamificationStore((state) => state.level);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);

  const sound = useSoundEffect();
  const [showXPGain, setShowXPGain] = useState(false);
  const [xpAmount, setXPAmount] = useState(0);

  const handleAddXP = (amount: number, reason: string) => {
    addXP(amount, reason);
    setXPAmount(amount);
    setShowXPGain(true);
    if (soundEnabled) {
      sound.play("xpGain");
    }
  };

  const handleUnlockAchievement = (achievementId: string) => {
    unlockAchievement(achievementId);
    if (soundEnabled) {
      sound.play("achievement");
    }
  };

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

      {/* Demo actions */}
      <Card>
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100 mb-4 flex items-center gap-2">
            <Target size={20} />
            Demo Actions
          </h3>
          <p className="text-sm text-gray-600 dark:text-zinc-400 mb-4">
            Try these actions to see the gamification system in action
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Button
              onClick={() => handleAddXP(10, "Demo action")}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Sparkles size={16} />
              Gain 10 XP
            </Button>
            <Button
              onClick={() => handleAddXP(50, "Big action")}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Sparkles size={16} />
              Gain 50 XP
            </Button>
            <Button
              onClick={() => handleAddXP(100, "Major milestone")}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Sparkles size={16} />
              Gain 100 XP
            </Button>
            <Button
              onClick={() => handleUnlockAchievement("first_loan")}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Gift size={16} />
              Unlock Achievement
            </Button>
          </div>
        </div>
      </Card>

      {/* Achievements */}
      <AchievementsPanel />

      {/* Settings */}
      <GamificationSettings />

      {/* Modals and animations */}
      <LevelUpModal />
      <XPGainAnimation
        amount={xpAmount}
        show={showXPGain}
        onComplete={() => setShowXPGain(false)}
        position="top"
      />
    </main>
  );
}
