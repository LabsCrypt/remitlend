"use client";

import { Toaster as SonnerToaster } from "sonner";
import { useEffect, useState } from "react";

/**
 * Toast notification component using Sonner.
 * Provides a clean, accessible toast system with dark mode support.
 */
export function Toaster() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <SonnerToaster
      position="top-right"
      expand={false}
      richColors
      closeButton
      duration={4000}
      toastOptions={{
        classNames: {
          toast:
            "rounded-xl border border-gray-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-950",
          title: "text-sm font-medium text-gray-900 dark:text-zinc-100",
          description: "text-sm text-gray-600 dark:text-zinc-400",
          actionButton: "bg-blue-600 text-white hover:bg-blue-700",
          cancelButton:
            "bg-gray-100 text-gray-900 hover:bg-gray-200 dark:bg-zinc-800 dark:text-zinc-100",
          closeButton: "bg-gray-100 hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700",
          success: "border-green-200 dark:border-green-900",
          error: "border-red-200 dark:border-red-900",
          warning: "border-yellow-200 dark:border-yellow-900",
          info: "border-blue-200 dark:border-blue-900",
        },
      }}
    />
  );
}
