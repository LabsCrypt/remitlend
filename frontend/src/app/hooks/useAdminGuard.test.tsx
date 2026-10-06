/**
 * hooks/useAdminGuard.test.tsx
 *
 * Regression tests for the admin authorization guard (#1884).
 *
 * `admin/governance` used `if (role && role !== "admin")`, so a falsy role —
 * an anonymous visitor, or an admin session that had not resolved yet — fell
 * straight through the guard and rendered the governance console. The role is
 * the whole basis of the check, so "unknown" must never read as "allowed".
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

const mockUseVerifySession = jest.fn();
jest.mock("./useApi", () => ({
  useVerifySession: (options?: unknown) => mockUseVerifySession(options),
}));

const mockUser = { user: null as { role: string } | null, authToken: null as string | null };
jest.mock("../stores/useUserStore", () => ({
  useUserStore: (selector: (state: typeof mockUser) => unknown) => selector(mockUser),
}));

import { useAdminGuard } from "./useAdminGuard";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function setSession(options: { data?: { role: string } | undefined; isLoading?: boolean }) {
  mockUseVerifySession.mockReturnValue({
    data: options.data,
    isLoading: options.isLoading ?? false,
  });
}

describe("useAdminGuard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.user = null;
    mockUser.authToken = null;
    setSession({});
  });

  it("reports a confirmed admin", async () => {
    mockUser.authToken = "token";
    setSession({ data: { role: "admin" } });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(true);
    expect(result.current.isChecking).toBe(false);
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
  });

  it("does not treat an unresolved role as admin", async () => {
    // The vulnerability: token present, session in flight, role not yet known.
    mockUser.authToken = "token";
    setSession({ isLoading: true });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isChecking).toBe(true);
  });

  it("does not treat a missing role as admin", async () => {
    mockUser.authToken = "token";
    setSession({ data: undefined, isLoading: false });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(false);
    expect(result.current.isChecking).toBe(false);
  });

  it("does not treat a falsy store role as admin", async () => {
    mockUser.authToken = "token";
    mockUser.user = { role: "" as string };
    setSession({ isLoading: false });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(false);
  });

  it("rejects an explicit non-admin role and redirects away", async () => {
    mockUser.authToken = "token";
    setSession({ data: { role: "borrower" } });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(false);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
  });

  it("prefers the server-verified role over the cached store role", async () => {
    // The store is client-side and tamperable; the verify response is not.
    mockUser.authToken = "token";
    mockUser.user = { role: "admin" };
    setSession({ data: { role: "borrower" } });

    const { result } = renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(result.current.isAdmin).toBe(false);
  });

  it("only enables session verification when a token exists", () => {
    mockUser.authToken = null;
    setSession({});

    renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    expect(mockUseVerifySession).toHaveBeenCalledWith({ enabled: false });
  });

  it("redirects an anonymous visitor", async () => {
    mockUser.authToken = null;
    setSession({});

    renderHook(() => useAdminGuard(), { wrapper: createWrapper() });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/"));
  });
});
