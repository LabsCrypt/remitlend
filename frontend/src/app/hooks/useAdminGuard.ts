"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useVerifySession } from "./useApi";
import { useUserStore } from "../stores/useUserStore";

/**
 * Shared authorization guard for admin-only pages.
 *
 * Previously duplicated inside `admin/disputes/page.tsx`; `admin/governance`
 * hand-rolled its own weaker version (`if (role && role !== "admin")`), which
 * skipped the guard entirely while the role was still undefined — see #1884.
 * Every admin surface now goes through this hook so that class of drift is
 * not possible.
 *
 * Authorization is derived exclusively from `useVerifySession` (server-side).
 * The local Zustand store's `user.role` is client-side and can be stale or
 * tampered with, so it must never influence `isAdmin` or `enabled` queries.
 * It is only consulted to suppress a brief loading spinner for already-known
 * admins (setting `isChecking` to false sooner).
 *
 * `isChecking` is true only while a token exists, the verify response is still
 * in flight, and the store offers no hint. That distinction lets callers render
 * a loading state for "not yet known" rather than treating unknown as allowed.
 */
export function useAdminGuard() {
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const token = useUserStore((state) => state.authToken);
  const session = useVerifySession({ enabled: Boolean(token) });

  // Authorization must come from the server-verified session only.
  // The store role is client-side and can be stale or tampered with; it is
  // allowed to suppress an initial spinner (isChecking) but must never set
  // isAdmin or gate enabled queries.
  const sessionRole = session.data?.role;
  const isAdmin = sessionRole === "admin";

  // isChecking is true while a token exists but the verify response has not
  // landed yet. The store role prevents a brief spinner for known admins, but
  // it does not influence isAdmin.
  const storeRole = user?.role;
  const isChecking = Boolean(token) && !sessionRole && session.isLoading && !storeRole;

  useEffect(() => {
    if (!token || (!isChecking && !isAdmin)) {
      router.replace("/");
    }
  }, [isAdmin, isChecking, router, token]);

  return { isAdmin, isChecking };
}
