/**
 * hooks/useContractMutation.test.tsx
 *
 * Tests for #1487: useContractMutation must scope the toast id per mutation call so
 * that overlapping mutations each resolve their own pending toast.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useContractMutation } from "./useContractMutation";
import { useToastStore } from "../stores/useToastStore";

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

interface Deferred {
  promise: Promise<{ txHash: string }>;
  resolve: (value: { txHash: string }) => void;
  reject: (reason: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<{ txHash: string }>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useContractMutation concurrent toasts", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it("resolves each concurrent mutation's own toast to success without leaving a pending toast", async () => {
    const { wrapper } = createTestHarness();
    const deferredA = createDeferred();
    const deferredB = createDeferred();

    const mutationFn = jest.fn((id: string) =>
      id === "A" ? deferredA.promise : deferredB.promise,
    );

    const { result } = renderHook(
      () =>
        useContractMutation(useMutation({ mutationFn }), {
          pendingMessage: "Processing...",
          successMessage: "Done!",
        }),
      { wrapper },
    );

    const promiseA = result.current.mutateAsync("A");
    const promiseB = result.current.mutateAsync("B");

    await waitFor(() => {
      const pending = useToastStore.getState().toasts.filter((t) => t.type === "info");
      expect(pending).toHaveLength(2);
    });

    const pendingIds = useToastStore
      .getState()
      .toasts.filter((t) => t.type === "info")
      .map((t) => t.id);

    deferredA.resolve({ txHash: "hash-a" });
    deferredB.resolve({ txHash: "hash-b" });

    await Promise.all([promiseA, promiseB]);

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.filter((t) => t.type === "info")).toHaveLength(0);
      expect(toasts.filter((t) => t.type === "success")).toHaveLength(2);
    });

    const successIds = useToastStore
      .getState()
      .toasts.filter((t) => t.type === "success")
      .map((t) => t.id);

    expect(successIds.sort()).toEqual(pendingIds.sort());
    expect(successIds).toHaveLength(2);
  });

  it("resolves each concurrent mutation's own toast to error without leaving a pending toast", async () => {
    const { wrapper } = createTestHarness();
    const deferredA = createDeferred();
    const deferredB = createDeferred();

    const mutationFn = jest.fn((id: string) =>
      id === "A" ? deferredA.promise : deferredB.promise,
    );

    const { result } = renderHook(
      () =>
        useContractMutation(useMutation({ mutationFn }), {
          pendingMessage: "Processing...",
          errorMessage: "Failed!",
        }),
      { wrapper },
    );

    const promiseA = result.current.mutateAsync("A");
    const promiseB = result.current.mutateAsync("B");

    await waitFor(() => {
      const pending = useToastStore.getState().toasts.filter((t) => t.type === "info");
      expect(pending).toHaveLength(2);
    });

    const pendingIds = useToastStore
      .getState()
      .toasts.filter((t) => t.type === "info")
      .map((t) => t.id);

    deferredA.reject(new Error("boom-a"));
    deferredB.reject(new Error("boom-b"));

    await Promise.allSettled([promiseA, promiseB]);

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.filter((t) => t.type === "info")).toHaveLength(0);
      expect(toasts.filter((t) => t.type === "error")).toHaveLength(2);
    });

    const errorIds = useToastStore
      .getState()
      .toasts.filter((t) => t.type === "error")
      .map((t) => t.id);

    expect(errorIds.sort()).toEqual(pendingIds.sort());
    expect(errorIds).toHaveLength(2);
  });

  it("resolves mixed success/error outcomes to their own toasts", async () => {
    const { wrapper } = createTestHarness();
    const deferredA = createDeferred();
    const deferredB = createDeferred();

    const mutationFn = jest.fn((id: string) =>
      id === "A" ? deferredA.promise : deferredB.promise,
    );

    const { result } = renderHook(
      () =>
        useContractMutation(useMutation({ mutationFn }), {
          pendingMessage: "Processing...",
          successMessage: "Done!",
          errorMessage: "Failed!",
        }),
      { wrapper },
    );

    const promiseA = result.current.mutateAsync("A");
    const promiseB = result.current.mutateAsync("B");

    await waitFor(() => {
      const pending = useToastStore.getState().toasts.filter((t) => t.type === "info");
      expect(pending).toHaveLength(2);
    });

    const pendingIds = useToastStore
      .getState()
      .toasts.filter((t) => t.type === "info")
      .map((t) => t.id);

    deferredA.resolve({ txHash: "hash-a" });
    deferredB.reject(new Error("boom-b"));

    await Promise.allSettled([promiseA, promiseB]);

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.filter((t) => t.type === "info")).toHaveLength(0);
      expect(toasts.filter((t) => t.type === "success")).toHaveLength(1);
      expect(toasts.filter((t) => t.type === "error")).toHaveLength(1);
    });

    const remainingIds = useToastStore
      .getState()
      .toasts.map((t) => t.id)
      .sort();
    expect(remainingIds).toEqual(pendingIds.sort());
  });
});
