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
 * The role is resolved from two sources, in order:
 *   1. `useVerifySession`, which asks the API who the token belongs to. This
 *      is authoritative: the role in the local store is whatever the last
 *      cached response said and can be stale or tampered with client-side.
 *   2. The local store's `user.role`, used only until the verify response
 *      lands so a known admin is not flashed a spinner.
 *
 * `isChecking` is true only while a token exists and neither source has
 * produced a role yet. That distinction matters: it is what lets a caller
 * render a loading state for "we do not know yet" instead of treating
 * "unknown" as "allowed".
 */
export function useAdminGuard() {
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const token = useUserStore((state) => state.authToken);
  const session = useVerifySession({ enabled: Boolean(token) });
  const role = session.data?.role ?? user?.role;
  const isChecking = Boolean(token) && !role && session.isLoading;
  const isAdmin = role === "admin";

  useEffect(() => {
    if (!token || (!isChecking && !isAdmin)) {
      router.replace("/");
    }
  }, [isAdmin, isChecking, router, token]);

  return { isAdmin, isChecking };
}
