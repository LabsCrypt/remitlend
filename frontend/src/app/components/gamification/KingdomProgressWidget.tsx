"use client";

import { motion } from "framer-motion";
import { Crown, TrendingUp } from "lucide-react";
import { useGamificationStore, getNextLevelInfo } from "@/app/stores/useGamificationStore";
import { Card } from "../ui/Card";

interface KingdomProgressWidgetProps {
  className?: string;
  compact?: boolean;
}

export function KingdomProgressWidget({ className, compact = false }: KingdomProgressWidgetProps) {
  const level = useGamificationStore((state) => state.level);
  const xp = useGamificationStore((state) => state.xp);
  const kingdomTitle = useGamificationStore((state) => state.kingdomTitle);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);

  const { nextLevel, xpToNext, progress } = getNextLevelInfo(xp);
  const isMaxLevel = nextLevel === level;

  if (compact) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-blue-600">
          <Crown size={20} className="text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              {kingdomTitle}
            </span>
            <span className="text-xs text-gray-600 dark:text-zinc-400">Lv. {level}</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800">
            <motion.div
              initial={animationsEnabled ? { width: 0 } : { width: `${progress}%` }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="h-full bg-gradient-to-r from-purple-600 to-blue-600"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card className={className}>
      <div className="p-6">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg">
              <Crown size={24} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-zinc-100">{kingdomTitle}</h3>
              <p className="text-sm text-gray-600 dark:text-zinc-400">Level {level}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{xp}</p>
            <p className="text-xs text-gray-600 dark:text-zinc-400">Total XP</p>
          </div>
        </div>

        {/* Progress bar */}
        {!isMaxLevel && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-zinc-400">
                Progress to Level {nextLevel}
              </span>
              <span className="font-semibold text-gray-900 dark:text-zinc-100">
                {xpToNext} XP needed
              </span>
            </div>
            <div className="relative h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800">
              <motion.div
                initial={animationsEnabled ? { width: 0 } : { width: `${progress}%` }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full bg-gradient-to-r from-purple-600 via-purple-500 to-blue-600"
              />
              {/* Shine effect */}
              {animationsEnabled && progress > 0 && (
                <motion.div
                  animate={{
                    x: ["-100%", "200%"],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                  style={{ width: "50%" }}
                />
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-zinc-500">
              <span>{progress.toFixed(1)}% complete</span>
              <div className="flex items-center gap-1">
                <TrendingUp size={12} />
                <span>Keep going!</span>
              </div>
            </div>
          </div>
        )}

        {/* Max level message */}
        {isMaxLevel && (
          <div className="rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 p-4 text-center dark:from-purple-950/30 dark:to-blue-950/30">
            <p className="text-sm font-semibold text-purple-900 dark:text-purple-100">
              👑 Maximum Level Reached!
            </p>
            <p className="mt-1 text-xs text-purple-700 dark:text-purple-300">
              You've achieved the highest rank in the Kingdom
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
