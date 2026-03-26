"use client";

import { useEffect, useState } from "react";
import { useGamificationStore } from "../../stores/useGamificationStore";
import { XPGainAnimation } from "../gamification/XPGainAnimation";
import { useSoundEffect } from "../../utils/soundManager";

export function GlobalXPGain() {
  const recentXPGain = useGamificationStore((state) => state.recentXPGain);
  const clearRecentXPGain = useGamificationStore((state) => state.clearRecentXPGain);
  const soundEnabled = useGamificationStore((state) => state.soundEnabled);
  const sound = useSoundEffect();

  const [queue, setQueue] = useState<{ amount: number; reason: string; id: number }[]>([]);
  const [activeGain, setActiveGain] = useState<{
    amount: number;
    reason: string;
    id: number;
  } | null>(null);

  useEffect(() => {
    if (recentXPGain) {
      setQueue((prev) => {
        // Prevent duplicate enqueue
        if (
          prev.find((item) => item.id === recentXPGain.id) ||
          activeGain?.id === recentXPGain.id
        ) {
          return prev;
        }
        return [...prev, recentXPGain];
      });
      clearRecentXPGain();
    }
  }, [recentXPGain, clearRecentXPGain, activeGain]);

  useEffect(() => {
    if (!activeGain && queue.length > 0) {
      const next = queue[0];
      setActiveGain(next);
      setQueue((prev) => prev.slice(1));
      if (soundEnabled) {
        sound.play("xpGain");
      }
    }
  }, [queue, activeGain, soundEnabled, sound]);

  if (!activeGain) return null;

  return (
    <div key={activeGain.id} className="pointer-events-none">
      <XPGainAnimation
        key={activeGain.id}
        amount={activeGain.amount}
        show={true}
        onComplete={() => {
          setActiveGain(null);
        }}
        position="top"
      />
    </div>
  );
}
