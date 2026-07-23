"use client";

import { useUserStore } from "../stores/useUserStore";
import { useWalletStore } from "../stores/useWalletStore";

const USER_STORAGE_KEY = "remitlend-user";
const WALLET_STORAGE_KEY = "remitlend-wallet";

let logoutTriggered = false;

export class SessionExpiredError extends Error {
  constructor(message = "Session expired. Please sign in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload || typeof window === "undefined") {
    return null;
  }

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(window.atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isJwtExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;

  return typeof exp === "number" && exp * 1000 <= Date.now();
}

export function clearSessionState() {
  useUserStore.getState().clearUser();
  useWalletStore.getState().disconnect();

  if (typeof window !== "undefined") {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
  }
}

export function logoutUser(reason: "manual" | "expired" = "manual") {
  clearSessionState();

  if (typeof window === "undefined" || logoutTriggered) {
    return;
  }

  logoutTriggered = true;
  const destination = reason === "expired" ? "/" : "/";
  window.setTimeout(() => {
    logoutTriggered = false;
  }, 0);
  window.location.assign(destination);
}
