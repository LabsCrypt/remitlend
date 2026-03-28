import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: ToastAction;
  txHash?: string;
  explorerUrl?: string;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id"> & { id?: string }) => string;
  updateToast: (id: string, updates: Partial<Omit<ToastItem, "id">>) => void;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_DURATION_MS = 5000;
const ERROR_DURATION_MS = 10000;
const MAX_STORED_TOASTS = 20;

let toastCounter = 0;

function createToastId(): string {
  toastCounter += 1;
  return `toast-${Date.now()}-${toastCounter}`;
}

function withDefaultDuration(toast: Omit<ToastItem, "id"> & { id?: string }): ToastItem {
  const duration =
    toast.duration ?? (toast.type === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS);

  return {
    ...toast,
    id: toast.id ?? createToastId(),
    duration,
  };
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const nextToast = withDefaultDuration(toast);

    set((state) => ({
      toasts: [nextToast, ...state.toasts].slice(0, MAX_STORED_TOASTS),
    }));

    return nextToast.id;
  },

  updateToast: (id, updates) => {
    set((state) => ({
      toasts: state.toasts.map((toast) => {
        if (toast.id !== id) {
          return toast;
        }

        const merged = {
          ...toast,
          ...updates,
        };

        if (updates.duration === undefined && updates.type && updates.type !== toast.type) {
          merged.duration = updates.type === "error" ? ERROR_DURATION_MS : DEFAULT_DURATION_MS;
        }

        return merged;
      }),
    }));
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },

  clearToasts: () => {
    set({ toasts: [] });
  },
}));
