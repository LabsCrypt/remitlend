/**
 * hooks/useConfirmedMutation.test.tsx
 *
 * Tests that useConfirmedMutation surfaces errors when the wrapped action rejects
 * instead of silently closing the confirmation dialog and leaving an unhandled
 * promise rejection.
 */

import { renderHook, act } from "@testing-library/react";
import { useConfirmedMutation } from "./useConfirmedMutation";
import { useToastStore } from "../stores/useToastStore";

function createDeferred(): {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useConfirmedMutation", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it("keeps the dialog open and surfaces an error toast when the action rejects", async () => {
    const deferred = createDeferred();
    const action = jest.fn(() => deferred.promise);

    const { result } = renderHook(() => useConfirmedMutation(action, { title: "Confirm" }));

    act(() => {
      result.current.trigger({ foo: "bar" } as never);
    });

    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.isLoading).toBe(false);

    act(() => {
      result.current.dialogProps.onConfirm();
    });

    expect(result.current.isLoading).toBe(true);

    deferred.reject(new Error("boom"));

    await act(async () => {
      await deferred.promise.catch(() => {});
    });

    // Dialog stays open on failure
    expect(result.current.dialogProps.isOpen).toBe(true);
    // Loading is cleared
    expect(result.current.isLoading).toBe(false);

    // An error toast is surfaced
    const errorToasts = useToastStore.getState().toasts.filter((t) => t.type === "error");
    expect(errorToasts).toHaveLength(1);
    expect(errorToasts[0].title).toBe("Transaction failed");
    expect(errorToasts[0].description).toContain("boom");
  });

  it("closes the dialog and surfaces no error toast when the action resolves", async () => {
    const deferred = createDeferred();
    const action = jest.fn(() => deferred.promise);

    const { result } = renderHook(() => useConfirmedMutation(action, { title: "Confirm" }));

    act(() => {
      result.current.trigger({ foo: "bar" } as never);
    });

    act(() => {
      result.current.dialogProps.onConfirm();
    });

    expect(result.current.dialogProps.isOpen).toBe(true);
    expect(result.current.isLoading).toBe(true);

    deferred.resolve(undefined);

    await act(async () => {
      await deferred.promise;
    });

    expect(result.current.dialogProps.isOpen).toBe(false);
    expect(result.current.isLoading).toBe(false);

    const errorToasts = useToastStore.getState().toasts.filter((t) => t.type === "error");
    expect(errorToasts).toHaveLength(0);
  });
});
