/**
 * hooks/useToast.ts
 *
 * Custom hook for showing toast notifications using Sonner
 */

import { toast } from "sonner";

export interface ToastConfig {
  title?: string;
  description?: string;
  variant?: "default" | "destructive" | "success";
}

export function useToast() {
  const showToast = (config: ToastConfig) => {
    if (config.variant === "destructive") {
      toast.error(config.title, {
        description: config.description,
      });
    } else if (config.variant === "success") {
      toast.success(config.title, {
        description: config.description,
      });
    } else {
      toast(config.title, {
        description: config.description,
      });
    }
  };

  return {
    toast: showToast,
  };
}
