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

import { render, screen, act, waitFor, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useUserStore, type User } from "../stores/useUserStore";
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
// hook's fetch ReadableStream reader drains one event at a time. When an abort
// signal is supplied, a pending read rejects with the same AbortError a real
// fetch body produces, so abort/cleanup behaviour can be asserted.
const createSseResponse = (signal?: AbortSignal): MockSse => {
  const encoder = new TextEncoder();
  const queue: Uint8Array[] = [];
  let queueReader: (() => void) | null = null;

  const pushEvent = (payload: unknown) => {
    queue.push(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    queueReader?.();
    queueReader = null;
  };

  const abortError = () => new DOMException("The operation was aborted", "AbortError");

  const reader = {
    read: () => {
      if (signal?.aborted) {
        return Promise.reject(abortError());
      }
      if (queue.length > 0) {
        return Promise.resolve({ done: false, value: queue.shift() as Uint8Array });
      }
      return new Promise<{ done: boolean; value: Uint8Array }>((resolve, reject) => {
        queueReader = () => {
          resolve({ done: false, value: queue.shift() as Uint8Array });
        };
        signal?.addEventListener(
          "abort",
          () => {
            queueReader = null;
            reject(abortError());
          },
          { once: true },
        );
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
};

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

interface MockUserState {
  user: User | null;
  authToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

// Mock useUserStore within the suite so tests can flip the auth token without
// touching the real persisted store.
jest.mock("../stores/useUserStore", () => {
  let mockUserState: MockUserState = {
    user: { id: "u1", email: "u1@example.com", kycVerified: true },
    authToken: "stream-test-token",
    isAuthenticated: true,
    isLoading: false,
    error: null,
  };
  const mockStoreFn = jest.fn((selector?: (s: MockUserState) => unknown) =>
    selector ? selector(mockUserState) : mockUserState,
  );
  const setState = jest.fn((newState: Partial<MockUserState>) => {
    mockUserState = { ...mockUserState, ...newState };
  });
  const getState = jest.fn(() => mockUserState);
  return { useUserStore: Object.assign(mockStoreFn, { setState, getState }) };
});

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

// Lets the async connect() reach its pending reader.read() without using real
// timers (the suite runs on fake timers).
const flushStreamSetup = async () => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
};

/**
 * Installs a fetch mock that builds one abort-aware SSE response per call and
 * records the AbortSignal each subscription was given.
 */
const mockSSEStreams = () => {
  const streams: MockSse[] = [];
  const signals: AbortSignal[] = [];
  const fetchMock = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
    const sse = createSseResponse(signal);
    streams.push(sse);
    signals.push(signal);
    return Promise.resolve(sse.response);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, streams, signals };
};

const seededQueryClient = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(["notifications", {}], { notifications: [], unreadCount: 0 });
  return queryClient;
};

function createWrapper(qc?: QueryClient) {
  const queryClient =
    qc ??
    new QueryClient({
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
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

  it("authenticates the stream request with the bearer token", async () => {
    const { response } = createSseResponse();
    const fetchMock = jest.fn().mockResolvedValue(response);
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper() });
    await flushStreamSetup();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(STREAM_URL);
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.headers).toEqual({
      Accept: "text/event-stream",
      Authorization: "Bearer stream-test-token",
    });
  });

  it("does not subscribe at all when there is no auth token", async () => {
    useUserStore.setState({ authToken: null });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper() });
    await act(() => jest.advanceTimersByTimeAsync(5_000));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a single subscription across re-renders with the same token", async () => {
    const { fetchMock, streams } = mockSSEStreams();
    const queryClient = seededQueryClient();

    const { rerender } = renderHook(() => useNotificationStream(), {
      wrapper: createWrapper(queryClient),
    });
    await flushStreamSetup();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender();
    rerender();
    await act(() => jest.advanceTimersByTimeAsync(1_000));

    // Re-rendering must not open a second stream or tear down the live one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      streams[0].pushEvent(n2);
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(
      queryClient.getQueryData<{ notifications: Array<{ id: number }> }>(["notifications", {}])
        ?.notifications,
    ).toEqual([expect.objectContaining({ id: n2.id })]);
  });

  it("aborts the old stream and reconnects when the auth token changes", async () => {
    const { fetchMock, signals } = mockSSEStreams();

    const { rerender } = renderHook(() => useNotificationStream(), {
      wrapper: createWrapper(),
    });
    await flushStreamSetup();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signals[0].aborted).toBe(false);

    useUserStore.setState({ authToken: "rotated-token" });
    rerender();
    await flushStreamSetup();

    // The stale subscription is torn down; exactly one live stream remains,
    // authenticated with the new token (no duplicate subscription survives).
    expect(signals[0].aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signals[1].aborted).toBe(false);
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      Authorization: "Bearer rotated-token",
    });
  });

  it("keeps two consumers' streams independent and aborts only the unmounted one", async () => {
    const { fetchMock, streams, signals } = mockSSEStreams();
    const queryClient = seededQueryClient();
    const wrapper = createWrapper(queryClient);

    const first = renderHook(() => useNotificationStream(), { wrapper });
    const second = renderHook(() => useNotificationStream(), { wrapper });
    await flushStreamSetup();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    first.unmount();

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // The surviving consumer still receives events into the shared cache.
    await act(async () => {
      streams[1].pushEvent(n2);
      await jest.advanceTimersByTimeAsync(0);
    });
    const cached = queryClient.getQueryData<{
      notifications: Array<{ id: number }>;
      unreadCount: number;
    }>(["notifications", {}]);
    expect(cached?.notifications.map((n) => n.id)).toEqual([n2.id]);
    expect(cached?.unreadCount).toBe(1);

    second.unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it("aborts the active stream on unmount and drops events that arrive afterwards", async () => {
    const { fetchMock, streams, signals } = mockSSEStreams();
    const queryClient = seededQueryClient();

    const { unmount } = renderHook(() => useNotificationStream(), {
      wrapper: createWrapper(queryClient),
    });
    await flushStreamSetup();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(signals[0].aborted).toBe(true);

    // A late event from the torn-down stream must not reach the cache, and no
    // reconnect may be scheduled after cleanup.
    act(() => streams[0].pushEvent(n1));
    await act(() => jest.advanceTimersByTimeAsync(5_000));

    expect(queryClient.getQueryData(["notifications", {}])).toEqual({
      notifications: [],
      unreadCount: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff on an authorization failure without touching the cache", async () => {
    const queryClient = seededQueryClient();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      body: null,
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper(queryClient) });

    // First attempt fails immediately and schedules a 1s retry.
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Backoff doubles: 2s, then 4s.
    await act(() => jest.advanceTimersByTimeAsync(2_000));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => jest.advanceTimersByTimeAsync(3_999));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);

    expect(queryClient.getQueryData(["notifications", {}])).toEqual({
      notifications: [],
      unreadCount: 0,
    });
  });

  it("caps reconnect backoff at 30 seconds when connections keep failing", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 503, body: null });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() => useNotificationStream(), { wrapper: createWrapper() });

    // Retries at ~1s, 3s, 7s, 15s, 31s — the next delay is capped at 30s.
    await act(() => jest.advanceTimersByTimeAsync(60_000));
    const callsAtSixtySeconds = fetchMock.mock.calls.length;
    expect(callsAtSixtySeconds).toBe(6);

    // The capped 30s timer fires at ~61s, not immediately after the 31s one.
    await act(() => jest.advanceTimersByTimeAsync(1_000));
    expect(fetchMock.mock.calls.length).toBe(callsAtSixtySeconds + 1);

    await act(() => jest.advanceTimersByTimeAsync(29_999));
    expect(fetchMock.mock.calls.length).toBe(callsAtSixtySeconds + 1);
    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(fetchMock.mock.calls.length).toBe(callsAtSixtySeconds + 2);
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
