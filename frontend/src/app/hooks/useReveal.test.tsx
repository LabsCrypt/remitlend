/**
 * hooks/useReveal.test.tsx
 *
 * Unit tests for useReveal (#1518):
 *  – success path: revealed value is stored and accessible
 *  – expired / access-denied path: error is surfaced, no value leaked
 *  – PII leak prevention: clearRevealed() nulls the value and resets state
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useReveal } from "./useReveal";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useReveal", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("stores the revealed value on a successful response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: "test@example.com" }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useReveal(), { wrapper: createWrapper() });

    act(() => {
      result.current.reveal({
        recipientId: "r-1",
        field: "email",
        reason: "audit",
      });
    });

    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(result.current.revealedValue).toBe("test@example.com");
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error and does not leak PII when the server returns 403 (access denied)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useReveal(), { wrapper: createWrapper() });

    act(() => {
      result.current.reveal({
        recipientId: "r-2",
        field: "phone",
        reason: "audit",
      });
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.revealedValue).toBeNull();
    expect(result.current.error?.message).toMatch(/Reveal failed/i);
  });

  it("surfaces an error and does not leak PII when the server returns 410 (reveal expired)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 410,
      statusText: "Gone",
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useReveal(), { wrapper: createWrapper() });

    act(() => {
      result.current.reveal({
        recipientId: "r-3",
        field: "name",
        reason: "compliance",
      });
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());

    expect(result.current.revealedValue).toBeNull();
  });

  it("clears revealedValue and resets mutation state via clearRevealed()", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ value: "John Doe" }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useReveal(), { wrapper: createWrapper() });

    act(() => {
      result.current.reveal({
        recipientId: "r-4",
        field: "name",
        reason: "audit",
      });
    });

    await waitFor(() => expect(result.current.revealedValue).toBe("John Doe"));

    act(() => {
      result.current.clearRevealed();
    });

    expect(result.current.revealedValue).toBeNull();
    expect(result.current.isPending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not expose the value before the request resolves", async () => {
    let resolveFetch!: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = jest.fn(() => fetchPromise) as unknown as typeof fetch;

    const { result } = renderHook(() => useReveal(), { wrapper: createWrapper() });

    act(() => {
      result.current.reveal({
        recipientId: "r-5",
        field: "email",
        reason: "audit",
      });
    });

    // While in-flight: no PII exposed
    expect(result.current.revealedValue).toBeNull();

    act(() => {
      resolveFetch({
        ok: true,
        json: async () => ({ value: "hidden@example.com" }),
      });
    });

    await waitFor(() => expect(result.current.revealedValue).toBe("hidden@example.com"));
  });
});
