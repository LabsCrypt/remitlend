/**
 * stores/useUserStore.ts
 *
 * Zustand store for authenticated user data.
 *
 * Responsibilities:
 *  - Hold the currently authenticated user profile (id, email, kycVerified, etc.)
 *  - Track authentication state (isAuthenticated, isLoading, error)
 *  - Provide actions to set / clear the user (login / logout)
 *
 * Design decision: server-fetched data lives in TanStack Query (useApi.ts).
 * This store holds the runtime session state so any component can read it
 * without prop-drilling or re-fetching.
 */

import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface User {
    id: string;
    email: string;
    walletAddress?: string;
    kycVerified: boolean;
    /** ISO 8601 timestamp of when the session was established */
    sessionStartedAt?: string;
}

interface UserState {
    /** Authenticated user, or null when logged out */
    user: User | null;
    /** True while an auth operation (login/logout/refresh) is in progress */
    isLoading: boolean;
    /** Error message from the last failed auth operation */
    error: string | null;
    /** Derived convenience flag */
    isAuthenticated: boolean;
}

interface UserActions {
    /** Call this after a successful login or session hydration */
    setUser: (user: User) => void;
    /** Call this on logout or session expiry — clears all user data */
    clearUser: () => void;
    /** Call this to update individual fields (e.g. after KYC verification) */
    updateUser: (partial: Partial<User>) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
}

export type UserStore = UserState & UserActions;

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: UserState = {
    user: null,
    isLoading: false,
    error: null,
    isAuthenticated: false,
};

// ─── Store ────────────────────────────────────────────────────────────────────

export const useUserStore = create<UserStore>()(
    devtools(
        persist(
            (set) => ({
                ...initialState,

                setUser: (user) =>
                    set(
                        {
                            user: { ...user, sessionStartedAt: new Date().toISOString() },
                            isAuthenticated: true,
                            error: null,
                            isLoading: false,
                        },
                        false,
                        "user/setUser",
                    ),

                clearUser: () =>
                    set(
                        { ...initialState },
                        false,
                        "user/clearUser",
                    ),

                updateUser: (partial) =>
                    set(
                        (state) => ({
                            user: state.user ? { ...state.user, ...partial } : null,
                        }),
                        false,
                        "user/updateUser",
                    ),

                setLoading: (isLoading) =>
                    set({ isLoading }, false, "user/setLoading"),

                setError: (error) =>
                    set({ error, isLoading: false }, false, "user/setError"),
            }),
            {
                name: "remitlend-user",
                // Only persist the user object — not transient loading/error state
                partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
            },
        ),
        { name: "UserStore" },
    ),
);

// ─── Selectors ────────────────────────────────────────────────────────────────
// Exporting selectors avoids inline arrow functions in components
// which would bypass Zustand's shallow-equality bailout.

export const selectUser = (state: UserStore) => state.user;
export const selectIsAuthenticated = (state: UserStore) => state.isAuthenticated;
export const selectUserIsLoading = (state: UserStore) => state.isLoading;
export const selectUserError = (state: UserStore) => state.error;
