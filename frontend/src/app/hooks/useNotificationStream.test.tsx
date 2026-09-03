/**
 * hooks/useNotificationStream.test.tsx
 *
 * Regression test for #1485: useNotificationStream must schedule reconnect
 * when the server closes the stream cleanly (reader.read() returns done: true).
 */

import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNotificationStream } from "./useNotificationStream";

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

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useNotificationStream", () => {
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
    const fetchMock = mockFetchCleanClose();
    global.fetch = fetchMock;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper() });

    // Advance enough for fetch to resolve, stream to close, and reconnect to fire.
    // Initial backoff is ~1s, so 1500ms covers the first reconnect.
    await act(() => jest.advanceTimersByTimeAsync(1500));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not schedule reconnect after AbortError (cleanup)", async () => {
    const fetchMock = jest.fn().mockImplementation(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    global.fetch = fetchMock;

    const { unmount } = renderHook(() => useNotificationStream(), {
      wrapper: createWrapper(),
    });

    unmount();

    await act(() => jest.advanceTimersByTimeAsync(5000));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff on clean stream close", async () => {
    const fetchMock = mockFetchCleanClose();
    global.fetch = fetchMock;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper() });

    // Advance enough for multiple reconnects with exponential backoff.
    // Initial: ~1s, then 2s, then 4s, then 8s. 10s covers ~3 reconnects.
    await act(() => jest.advanceTimersByTimeAsync(10_000));

    // Should have been called at least 3 times (initial + 2 reconnects)
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not reconnect when unmounted after initial connection", async () => {
    const fetchMock = mockFetchCleanClose();
    global.fetch = fetchMock;

    const { unmount } = renderHook(() => useNotificationStream(), {
      wrapper: createWrapper(),
    });

    // Let hook connect
    await act(() => jest.advanceTimersByTimeAsync(500));

    unmount();

    await act(() => jest.advanceTimersByTimeAsync(5000));

    // No additional fetch calls after unmount
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
