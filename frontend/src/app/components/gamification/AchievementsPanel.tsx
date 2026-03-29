"use client";

import { motion } from "framer-motion";
import { Lock, CheckCircle } from "lucide-react";
import { useGamificationStore } from "@/app/stores/useGamificationStore";
import { Card, CardHeader, CardTitle, CardContent } from "../ui/Card";

interface AchievementsPanelProps {
  className?: string;
}

export function AchievementsPanel({ className }: AchievementsPanelProps) {
  const achievements = useGamificationStore((state) => state.achievements);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);

  const unlockedCount = achievements.filter((a) => a.unlockedAt).length;
  const totalCount = achievements.length;
  const completionPercentage = (unlockedCount / totalCount) * 100;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Achievements</CardTitle>
          <div className="text-sm text-gray-600 dark:text-zinc-400">
            {unlockedCount} / {totalCount}
          </div>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800">
          <motion.div
            initial={animationsEnabled ? { width: 0 } : { width: `${completionPercentage}%` }}
            animate={{ width: `${completionPercentage}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-green-600 to-blue-600"
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {achievements.map((achievement, index) => {
            const isUnlocked = !!achievement.unlockedAt;
            const progress = achievement.progress || 0;
            const maxProgress = achievement.maxProgress || 1;
            const progressPercentage = (progress / maxProgress) * 100;

            return (
              <motion.div
                key={achievement.id}
                initial={animationsEnabled ? { opacity: 0, y: 20 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: index * 0.05 }}
                className={`rounded-lg border p-4 transition-all ${
                  isUnlocked
                    ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30"
                    : "border-gray-200 bg-gray-50 dark:border-zinc-800 dark:bg-zinc-900"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div
                    className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl ${
                      isUnlocked
                        ? "bg-green-100 dark:bg-green-900/50"
                        : "bg-gray-200 dark:bg-zinc-800"
                    }`}
                  >
                    {isUnlocked ? achievement.icon : <Lock size={20} className="text-gray-400" />}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4
                        className={`text-sm font-semibold ${
                          isUnlocked
                            ? "text-green-900 dark:text-green-100"
                            : "text-gray-600 dark:text-zinc-400"
                        }`}
                      >
                        {achievement.title}
                      </h4>
                      {isUnlocked && (
                        <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
                      )}
                    </div>
                    <p
                      className={`mt-1 text-xs ${
                        isUnlocked
                          ? "text-green-700 dark:text-green-300"
                          : "text-gray-500 dark:text-zinc-500"
                      }`}
                    >
                      {achievement.description}
                    </p>

                    {/* Progress bar for locked achievements */}
                    {!isUnlocked && maxProgress > 1 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-zinc-400">
                          <span>Progress</span>
                          <span>
                            {progress} / {maxProgress}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-zinc-800">
                          <motion.div
                            initial={
                              animationsEnabled ? { width: 0 } : { width: `${progressPercentage}%` }
                            }
                            animate={{ width: `${progressPercentage}%` }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className="h-full bg-gradient-to-r from-blue-600 to-purple-600"
                          />
                        </div>
                      </div>
                    )}

                    {/* Unlock date */}
                    {isUnlocked && achievement.unlockedAt && (
                      <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                        Unlocked {new Date(achievement.unlockedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
