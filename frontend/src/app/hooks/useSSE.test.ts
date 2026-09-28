/**
 * hooks/useSSE.test.ts
 *
 * Regression test for #1485: SSE hooks must schedule reconnect when the
 * server closes the stream cleanly (reader.read() returns done: true),
 * not just on errors.
 */

import { renderHook, act } from "@testing-library/react";
import { useSSE } from "./useSSE";

// Mock useUserStore
jest.mock("../stores/useUserStore", () => ({
  useUserStore: jest.fn(),
}));

const { useUserStore } = require("../stores/useUserStore");

/**
 * Creates a mock fetch response whose body.getReader().read() returns
 * { done: true } immediately — simulating a clean server-side close.
 */
function mockFetchCleanClose() {
  return jest.fn().mockResolvedValue({
    ok: true,
    body: {
      getReader() {
        return {
          read() {
            return Promise.resolve({ done: true, value: undefined });
          },
        };
      },
    },
  });
}

describe("useSSE", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    (useUserStore as unknown as jest.Mock).mockReturnValue({ authToken: "test-token" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("schedules reconnect when stream ends cleanly (done: true)", async () => {
    global.fetch = mockFetchCleanClose();

    renderHook(() =>
      useSSE({
        url: "http://localhost:3001/api/events/stream",
        onMessage: jest.fn(),
      }),
    );

    // Advance enough for the initial fetch to resolve, stream to close,
    // and the first reconnect timer to fire (initial backoff is 1s).
    await act(() => jest.advanceTimersByTimeAsync(1500));

    // fetch was called for the initial connection + at least one reconnect
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("schedules multiple reconnects with backoff on repeated clean closes", async () => {
    global.fetch = mockFetchCleanClose();

    renderHook(() =>
      useSSE({
        url: "http://localhost:3001/api/events/stream",
        onMessage: jest.fn(),
      }),
    );

    // Advance 5s to trigger multiple reconnects (1s + 2s backoff)
    await act(() => jest.advanceTimersByTimeAsync(5000));

    // Should have been called at least 3 times (initial + 2 reconnects)
    expect((global.fetch as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not schedule reconnect after AbortError (cleanup)", async () => {
    const fetchMock = jest.fn().mockImplementation(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    global.fetch = fetchMock;

    const { unmount } = renderHook(() =>
      useSSE({
        url: "http://localhost:3001/api/events/stream",
        onMessage: jest.fn(),
      }),
    );

    unmount();

    await act(() => jest.advanceTimersByTimeAsync(5000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect when url is null", async () => {
    const fetchMock = mockFetchCleanClose();
    global.fetch = fetchMock;

    renderHook(() =>
      useSSE({
        url: null,
        onMessage: jest.fn(),
      }),
    );

    await act(() => jest.advanceTimersByTimeAsync(5000));

    // fetch should never be called when url is null
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("periodically re-attempts SSE while in polling mode and stops polling on reconnect (closes #1891)", async () => {
    let sseAttempts = 0;
    const pollCallback = jest.fn();
    const onOpen = jest.fn();

    // First 3 calls reject to exhaust maxReconnectAttempts and force polling.
    // 4th call (during periodic recovery) succeeds!
    global.fetch = jest.fn().mockImplementation(() => {
      sseAttempts += 1;
      if (sseAttempts <= 3) {
        return Promise.reject(new Error("SSE connection error"));
      }
      return Promise.resolve({
        ok: true,
        body: {
          getReader() {
            return {
              read() {
                // Keep stream connection open
                return new Promise(() => {});
              },
            };
          },
        },
      });
    });

    const { result } = renderHook(() =>
      useSSE({
        url: "http://localhost:3001/api/events/stream",
        onMessage: jest.fn(),
        onOpen,
        onFallbackPoll: pollCallback,
        pollingInterval: 10_000,
        sseRecoveryInterval: 20_000,
      }),
    );

    // Advance through the initial retry sequence to reach max attempts and enter polling
    await act(() => jest.advanceTimersByTimeAsync(1500));
    await act(() => jest.advanceTimersByTimeAsync(2500));
    await act(() => jest.advanceTimersByTimeAsync(5000));

    expect(result.current).toBe("polling");
    expect(pollCallback).toHaveBeenCalled();
    const pollCountBeforeRecovery = pollCallback.mock.calls.length;

    // Advance for sseRecoveryInterval (20s) to trigger periodic recovery connect()
    await act(() => jest.advanceTimersByTimeAsync(20000));

    // Recovery succeeded: status should be connected and onOpen invoked
    expect(result.current).toBe("connected");
    expect(onOpen).toHaveBeenCalled();

    // Verify polling has stopped by advancing further
    const pollCountAfterRecovery = pollCallback.mock.calls.length;
    await act(() => jest.advanceTimersByTimeAsync(30000));
    expect(pollCallback.mock.calls.length).toBe(pollCountAfterRecovery);
  });
});
