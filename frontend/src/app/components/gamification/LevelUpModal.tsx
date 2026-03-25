"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Crown, Sparkles, Gift } from "lucide-react";
import { useGamificationStore } from "@/app/stores/useGamificationStore";
import { useSoundEffect } from "@/app/utils/soundManager";
import { Button } from "../ui/Button";

export function LevelUpModal() {
  const showModal = useGamificationStore((state) => state.showLevelUpModal);
  const pendingLevelUp = useGamificationStore((state) => state.pendingLevelUp);
  const dismissLevelUp = useGamificationStore((state) => state.dismissLevelUp);
  const soundEnabled = useGamificationStore((state) => state.soundEnabled);
  const animationsEnabled = useGamificationStore((state) => state.animationsEnabled);

  const sound = useSoundEffect();

  useEffect(() => {
    if (showModal && soundEnabled) {
      sound.play("levelUp");
    }
  }, [showModal, soundEnabled, sound]);

  if (!pendingLevelUp) return null;

  const handleClose = () => {
    if (soundEnabled) {
      sound.play("click");
    }
    dismissLevelUp();
  };

  return (
    <AnimatePresence>
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Modal */}
          <motion.div
            initial={animationsEnabled ? { scale: 0.5, opacity: 0, y: 50 } : { opacity: 0 }}
            animate={animationsEnabled ? { scale: 1, opacity: 1, y: 0 } : { opacity: 1 }}
            exit={animationsEnabled ? { scale: 0.8, opacity: 0, y: 20 } : { opacity: 0 }}
            transition={{ type: "spring", duration: 0.5 }}
            className="relative w-full max-w-md overflow-hidden rounded-2xl bg-gradient-to-br from-purple-50 to-blue-50 shadow-2xl dark:from-purple-950/30 dark:to-blue-950/30 dark:border dark:border-purple-800"
          >
            {/* Animated background sparkles */}
            {animationsEnabled && (
              <>
                <motion.div
                  animate={{
                    scale: [1, 1.2, 1],
                    rotate: [0, 180, 360],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="absolute top-10 right-10 text-yellow-400 opacity-30"
                >
                  <Sparkles size={40} />
                </motion.div>
                <motion.div
                  animate={{
                    scale: [1, 1.3, 1],
                    rotate: [360, 180, 0],
                  }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="absolute bottom-10 left-10 text-purple-400 opacity-20"
                >
                  <Sparkles size={30} />
                </motion.div>
              </>
            )}

            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 rounded-full p-2 text-gray-600 hover:bg-white/50 dark:text-gray-400 dark:hover:bg-black/20"
            >
              <X size={20} />
            </button>

            {/* Content */}
            <div className="relative p-8 text-center">
              {/* Crown icon with animation */}
              <motion.div
                initial={animationsEnabled ? { scale: 0, rotate: -180 } : {}}
                animate={animationsEnabled ? { scale: 1, rotate: 0 } : {}}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 shadow-lg"
              >
                <Crown size={48} className="text-white" />
              </motion.div>

              {/* Level up text */}
              <motion.h2
                initial={animationsEnabled ? { opacity: 0, y: 20 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.3 }}
                className="mb-2 text-3xl font-bold text-purple-900 dark:text-purple-100"
              >
                Level Up!
              </motion.h2>

              <motion.p
                initial={animationsEnabled ? { opacity: 0, y: 20 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.4 }}
                className="mb-6 text-lg text-purple-700 dark:text-purple-300"
              >
                You are now a{" "}
                <span className="font-bold text-purple-900 dark:text-purple-100">
                  {pendingLevelUp.title}
                </span>
              </motion.p>

              {/* Level badge */}
              <motion.div
                initial={animationsEnabled ? { scale: 0 } : {}}
                animate={animationsEnabled ? { scale: 1 } : {}}
                transition={{ delay: 0.5, type: "spring" }}
                className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full bg-purple-600 px-6 py-3 text-white shadow-lg"
              >
                <span className="text-2xl font-bold">Level {pendingLevelUp.level}</span>
              </motion.div>

              {/* Rewards */}
              <motion.div
                initial={animationsEnabled ? { opacity: 0, y: 20 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.6 }}
                className="mb-6 rounded-xl bg-white/50 p-4 dark:bg-black/20"
              >
                <div className="mb-3 flex items-center justify-center gap-2 text-purple-900 dark:text-purple-100">
                  <Gift size={20} />
                  <h3 className="font-semibold">Rewards Unlocked</h3>
                </div>
                <ul className="space-y-2 text-sm text-purple-700 dark:text-purple-300">
                  {pendingLevelUp.rewards.map((reward, index) => (
                    <motion.li
                      key={index}
                      initial={animationsEnabled ? { opacity: 0, x: -20 } : {}}
                      animate={animationsEnabled ? { opacity: 1, x: 0 } : {}}
                      transition={{ delay: 0.7 + index * 0.1 }}
                      className="flex items-center justify-center gap-2"
                    >
                      <span className="text-green-600 dark:text-green-400">✓</span>
                      {reward}
                    </motion.li>
                  ))}
                </ul>
              </motion.div>

              {/* Continue button */}
              <motion.div
                initial={animationsEnabled ? { opacity: 0, y: 20 } : {}}
                animate={animationsEnabled ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.9 }}
              >
                <Button
                  onClick={handleClose}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                >
                  Continue Your Journey
                </Button>
              </motion.div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
