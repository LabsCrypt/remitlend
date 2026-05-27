"use client";

import { useEffect, useState } from "react";
import { Download } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 shadow-lg dark:border-indigo-900/50 dark:bg-indigo-950/40">
      <Download className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
      <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">
        Install RemitLend for offline access
      </p>
      <button
        type="button"
        onClick={handleInstall}
        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
      >
        Install
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-indigo-400 transition hover:text-indigo-600"
        aria-label="Dismiss install prompt"
      >
        &times;
      </button>
    </div>
  );
}
