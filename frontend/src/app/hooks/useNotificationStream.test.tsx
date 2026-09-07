/**
 * hooks/useNotificationStream.test.tsx
 *
 * Regression test for #1071: SSE stream updates must land in the cache entry
 * that list readers actually subscribe to (the dropdown's `["notifications", {}]`
 * and the inbox page's `["notifications", { limit, type, unread }]` keys), so a
 * pushed notification renders immediately instead of waiting for the 60s poll.
 *
 * Previously the stream wrote to `["notifications"]` via setQueryData, which only
 * matches that exact key, so live notifications did not show up in the bell/inbox.
 */

import { render, screen, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUserStore } from "../stores/useUserStore";
import { useNotificationStream } from "./useNotificationStream";
import { useNotifications } from "./useApi";

// jsdom in this environment lacks TextEncoder/TextDecoder which the stream hook
// relies on for decoding the SSE body. Provide them from Node's util module.
import { TextEncoder, TextDecoder } from "node:util";
(globalThis as Record<string, unknown>).TextEncoder = TextEncoder;
(globalThis as Record<string, unknown>).TextDecoder = TextDecoder;

const STREAM_URL = "http://localhost:3001/api/notifications/stream";

interface MockSse {
  response: { ok: boolean; status: number; statusText: string; body: { getReader: () => object } };
  pushEvent: (payload: unknown) => void;
}

// A controllable SSE response. The test pushes events into a queue that the
// hook's fetch ReadableStream reader drains one event at a time.
function createSseResponse(): MockSse {
  const encoder = new TextEncoder();
  const queue: Uint8Array[] = [];
  let queueReader: (() => void) | null = null;
  let closed = false;

  const pushEvent = (payload: unknown) => {
    queue.push(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    queueReader?.();
    queueReader = null;
  };

  const reader = {
    read: () => {
      if (queue.length > 0) {
        return Promise.resolve({ done: false, value: queue.shift() as Uint8Array });
      }
      if (closed) {
        return Promise.resolve({ done: true, value: new Uint8Array(0) });
      }
      return new Promise<{ done: boolean; value: Uint8Array }>((resolve) => {
        queueReader = () => {
          if (queue.length > 0) {
            resolve({ done: false, value: queue.shift() as Uint8Array });
          } else {
            resolve({ done: true, value: new Uint8Array(0) });
          }
        };
      });
    },
  };

  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    body: { getReader: () => reader },
  };

  return { response, pushEvent };
}

function Harness() {
  useNotificationStream();
  const { data } = useNotifications();
  return (
    <div>
      <span data-testid="unread">{data?.unreadCount ?? 0}</span>
      <ul>
        {(data?.notifications ?? []).map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
    </div>
  );
}

function createWrapper(queryClient: QueryClient) {
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

const n1 = {
  id: 1,
  userId: "u1",
  type: "repayment_due",
  title: "Existing notification",
  message: "Already there",
  read: false,
  createdAt: "2026-08-01T10:00:00.000Z",
};

const n2 = {
  id: 2,
  userId: "u1",
  type: "loan_approved",
  title: "Streamed notification",
  message: "Arrived over SSE",
  read: false,
  createdAt: "2026-08-02T10:00:00.000Z",
};

describe("useNotificationStream", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useUserStore.setState({
      user: { id: "u1", email: "u1@example.com", kycVerified: true },
      authToken: "stream-test-token",
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    jest.useFakeTimers();
    (useUserStore as unknown as jest.Mock).mockReturnValue({ authToken: "test-token" });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("renders a streamed notification immediately in the list reader's cache entry", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { response, pushEvent } = createSseResponse();

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith(STREAM_URL)) {
        return Promise.resolve(response);
      }
      // Initial HTTP list fetch used by useNotifications() on mount.
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { notifications: [n1], unreadCount: 1 } }),
      });
    }) as unknown as typeof fetch;

    render(<Harness />, { wrapper: createWrapper(queryClient) });

    // The initial HTTP fetch populates the list reader's cache entry.
    await waitFor(() => expect(screen.getByText("Existing notification")).toBeInTheDocument());
    expect(screen.getByTestId("unread").textContent).toBe("1");

    // Push a new notification over SSE — it must appear without a 60s poll.
    act(() => {
      pushEvent(n2);
    });

    await waitFor(() => expect(screen.getByText("Streamed notification")).toBeInTheDocument());
    expect(screen.getByTestId("unread").textContent).toBe("2");
  });

  it("still merges init notifications and recomputes the unread count on the list key", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { response, pushEvent } = createSseResponse();

    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.startsWith(STREAM_URL)) {
        return Promise.resolve(response);
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: { notifications: [n2], unreadCount: 1 } }),
      });
    }) as unknown as typeof fetch;

    render(<Harness />, { wrapper: createWrapper(queryClient) });
    await waitFor(() => expect(screen.getByText("Streamed notification")).toBeInTheDocument());

    // Reveal an unread notification that the client didn't know about yet.
    act(() => {
      pushEvent({ type: "init", notifications: [n1] });
    });

    // Both notifications are present and the unread count accounts for both.
    await waitFor(() => expect(screen.getByText("Existing notification")).toBeInTheDocument());
    expect(screen.getByText("Streamed notification")).toBeInTheDocument();
    expect(screen.getByTestId("unread").textContent).toBe("2");
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
