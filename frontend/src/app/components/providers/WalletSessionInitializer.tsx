"use client";

import { useEffect } from "react";
import { useWalletStore } from "@/app/stores/useWalletStore";

export function WalletSessionInitializer() {
  const initializeSession = useWalletStore((state) => state.initializeSession);

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  return null;
}
