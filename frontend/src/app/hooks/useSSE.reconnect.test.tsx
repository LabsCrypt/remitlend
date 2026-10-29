/**
 * hooks/useSSE.reconnect.test.tsx
 *
 * Regression coverage for #2136: the SSE hook had no tests for retry backoff,
 * malformed events, authorization, or cleanup.
 *
 * The real `useSSE` transport is driven against a controllable fake server, so
 * backoff timing, the three-attempt cap, fallback polling and teardown are
 * exercised end-to-end. Aborting a connection rejects the pending read with an
 * `AbortError`, exactly as a real `fetch` stream does.
 */

import { act, renderHook } from "@testing-library/react";
import { useSSE } from "./useSSE";
import { useUserStore } from "../stores/useUserStore";

const URL_A = "/api/events/stream?borrower=GA";
const URL_B = "/api/events/stream?borrower=GB";

type Step = "open" | "null-body" | "network-error" | { status: number; statusText: string };

interface Connection {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  /** Queue a raw chunk of bytes; no frame terminator is added. */
  chunk: (raw: string) => void;
  /** Queue one complete `data:` frame. */
  send: (payload: unknown) => void;
  /** End the stream cleanly (`reader.read()` resolves with `done: true`). */
  close: () => void;
}

const abortError = () =>
  Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

const createConnection = (url: string, init: RequestInit) => {
  const encoder = new TextEncoder();
  const queue: Uint8Array[] = [];
  let pending: {
    resolve: (r: { done: boolean; value?: Uint8Array }) => void;
    reject: (e: Error) => void;
  } | null = null;
  let closed = false;
  let aborted = false;
  const signal = init.signal as AbortSignal;

  const drain = () => {
    if (!pending) return;
    if (queue.length > 0) {
      const { resolve } = pending;
      pending = null;
      resolve({ done: false, value: queue.shift() });
    } else if (closed) {
      const { resolve } = pending;
      pending = null;
      resolve({ done: true, value: undefined });
    }
  };

  signal.addEventListener("abort", () => {
    aborted = true;
    if (pending) {
      const { reject } = pending;
      pending = null;
      reject(abortError());
    }
  });

  const reader = {
    read: () => {
      if (aborted) return Promise.reject(abortError());
      if (queue.length > 0) return Promise.resolve({ done: false, value: queue.shift() });
      if (closed) return Promise.resolve({ done: true, value: undefined });
      return new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
        pending = { resolve, reject };
      });
    },
  };

  const connection: Connection = {
    url,
    headers: (init.headers ?? {}) as Record<string, string>,
    signal,
    chunk: (raw) => {
      queue.push(encoder.encode(raw));
      drain();
    },
    send: (payload) => connection.chunk(`data: ${JSON.stringify(payload)}\n\n`),
    close: () => {
      closed = true;
      drain();
    },
  };

  return {
    connection,
    response: { ok: true, status: 200, statusText: "OK", body: { getReader: () => reader } },
  };
};

/** A fake SSE server. Each fetch consumes the next scripted step (default: "open"). */
const createServer = (script: Step[] = []) => {
  const connections: Connection[] = [];
  const fetchMock = jest.fn((url: string, init: RequestInit) => {
    const step = script.shift() ?? "open";
    if (step === "network-error") return Promise.reject(new TypeError("Failed to fetch"));
    if (step === "null-body") {
      return Promise.resolve({ ok: true, status: 200, statusText: "OK", body: null });
    }
    if (typeof step === "object") {
      return Promise.resolve({
        ok: false,
        status: step.status,
        statusText: step.statusText,
        body: null,
      });
    }
    const { connection, response } = createConnection(url, init);
    connections.push(connection);
    return Promise.resolve(response);
  });
  return { fetchMock, connections };
};

const flush = () =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

describe("useSSE reconnect, auth, parsing and cleanup (#2136)", () => {
  const originalFetch = global.fetch;
  let server: ReturnType<typeof createServer>;

  const install = (script: Step[] = []) => {
    server = createServer(script);
    global.fetch = server.fetchMock as unknown as typeof fetch;
    return server;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    useUserStore.setState({ authToken: null });
    install();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  // ─── connection, authorization and delivery ──────────────────────────────

  describe("connection and authorization", () => {
    it("connects with the SSE Accept header and no Authorization when signed out", async () => {
      const onOpen = jest.fn();
      const { result } = renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onOpen }));

      expect(result.current).toBe("connecting");
      await flush();

      expect(server.fetchMock).toHaveBeenCalledTimes(1);
      expect(server.connections[0].url).toBe(URL_A);
      expect(server.connections[0].headers).toEqual({ Accept: "text/event-stream" });
      expect(result.current).toBe("connected");
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("sends the bearer token when the user is authenticated", async () => {
      useUserStore.setState({ authToken: "jwt-123" });
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));
      await flush();

      expect(server.connections[0].headers).toEqual({
        Accept: "text/event-stream",
        Authorization: "Bearer jwt-123",
      });
    });

    it("aborts and reconnects with the new credentials when the token changes", async () => {
      useUserStore.setState({ authToken: "old-token" });
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));
      await flush();
      const first = server.connections[0];

      await act(async () => {
        useUserStore.setState({ authToken: "new-token" });
      });
      await flush();

      expect(first.signal.aborted).toBe(true);
      expect(server.connections).toHaveLength(2);
      expect(server.connections[1].headers.Authorization).toBe("Bearer new-token");
    });

    it("stops the previous stream and connects to the new url when the url changes", async () => {
      const { rerender } = renderHook(({ url }) => useSSE({ url, onMessage: jest.fn() }), {
        initialProps: { url: URL_A },
      });
      await flush();

      rerender({ url: URL_B });
      await flush();

      expect(server.connections[0].signal.aborted).toBe(true);
      expect(server.connections[1].url).toBe(URL_B);
    });

    it("does not connect and reports disconnected when the url is null", async () => {
      const { result } = renderHook(() => useSSE({ url: null, onMessage: jest.fn() }));
      await advance(60_000);

      expect(server.fetchMock).not.toHaveBeenCalled();
      expect(result.current).toBe("disconnected");
    });

    it("aborts the stream and reports disconnected when the url is cleared", async () => {
      const { result, rerender } = renderHook(
        ({ url }: { url: string | null }) => useSSE({ url, onMessage: jest.fn() }),
        { initialProps: { url: URL_A as string | null } },
      );
      await flush();
      expect(result.current).toBe("connected");

      rerender({ url: null });
      await flush();

      expect(server.connections[0].signal.aborted).toBe(true);
      expect(result.current).toBe("disconnected");
    });
  });

  describe("event delivery", () => {
    it("delivers every data frame to onMessage in order, even within one chunk", async () => {
      const onMessage = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage }));
      await flush();

      server.connections[0].chunk('data: {"n":1}\n\ndata: {"n":2}\n\n');
      server.connections[0].send({ n: 3 });
      await flush();

      expect(onMessage.mock.calls.map(([payload]) => payload)).toEqual([
        { n: 1 },
        { n: 2 },
        { n: 3 },
      ]);
    });

    it("reassembles a frame that is split across network chunks", async () => {
      const onMessage = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage }));
      await flush();

      server.connections[0].chunk('data: {"loan":');
      await flush();
      expect(onMessage).not.toHaveBeenCalled();

      server.connections[0].chunk("42}\n\n");
      await flush();
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({ loan: 42 });
    });

    it("ignores comment/keep-alive lines and non-data fields", async () => {
      const onMessage = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage }));
      await flush();

      server.connections[0].chunk(": keep-alive\n\n");
      server.connections[0].chunk('event: update\nid: 7\ndata: {"ok":true}\n\n');
      await flush();

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({ ok: true });
    });

    it("uses the latest onMessage without reconnecting", async () => {
      const first = jest.fn();
      const second = jest.fn();
      const { rerender } = renderHook(({ onMessage }) => useSSE({ url: URL_A, onMessage }), {
        initialProps: { onMessage: first },
      });
      await flush();

      rerender({ onMessage: second });
      await flush();
      server.connections[0].send({ n: 1 });
      await flush();

      expect(server.fetchMock).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith({ n: 1 });
    });
  });

  // ─── malformed events ────────────────────────────────────────────────────

  describe("malformed events", () => {
    it("logs and skips an unparsable frame without dropping the stream", async () => {
      const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
      const onMessage = jest.fn();
      const onError = jest.fn();
      const { result } = renderHook(() => useSSE({ url: URL_A, onMessage, onError }));
      await flush();

      server.connections[0].chunk("data: {not valid json\n\n");
      await flush();

      expect(onMessage).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to parse SSE data",
        expect.any(SyntaxError),
      );
      expect(result.current).toBe("connected");
      expect(server.fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps delivering valid frames that follow a malformed one", async () => {
      jest.spyOn(console, "error").mockImplementation(() => undefined);
      const onMessage = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage }));
      await flush();

      server.connections[0].chunk('data: oops\n\ndata: {"after":"bad"}\n\n');
      await flush();

      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith({ after: "bad" });
    });
  });

  // ─── retry backoff ───────────────────────────────────────────────────────

  describe("retry backoff", () => {
    it("reports a non-OK response and retries after the initial 1s delay", async () => {
      install([{ status: 401, statusText: "Unauthorized" }]);
      const onError = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toEqual(
        new Error("SSE connection failed: 401 Unauthorized"),
      );
      expect(server.fetchMock).toHaveBeenCalledTimes(1);

      await advance(999);
      expect(server.fetchMock).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(server.fetchMock).toHaveBeenCalledTimes(2);
    });

    it("doubles the delay between consecutive failures (1s, then 2s)", async () => {
      install([
        { status: 503, statusText: "Service Unavailable" },
        { status: 503, statusText: "Service Unavailable" },
      ]);
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));
      await flush();
      expect(server.fetchMock).toHaveBeenCalledTimes(1);

      await advance(1_000); // 1st retry
      expect(server.fetchMock).toHaveBeenCalledTimes(2);

      await advance(1_999);
      expect(server.fetchMock).toHaveBeenCalledTimes(2);
      await advance(1); // 2nd retry after 2s
      expect(server.fetchMock).toHaveBeenCalledTimes(3);
    });

    it("gives up after three failed attempts and schedules nothing further", async () => {
      install([
        { status: 500, statusText: "Internal Server Error" },
        { status: 500, statusText: "Internal Server Error" },
        { status: 500, statusText: "Internal Server Error" },
      ]);
      const onError = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));

      await advance(10_000);
      expect(server.fetchMock).toHaveBeenCalledTimes(3);
      expect(onError).toHaveBeenCalledTimes(3);

      await advance(120_000);
      expect(server.fetchMock).toHaveBeenCalledTimes(3);
    });

    it("treats a missing response body as a connection error", async () => {
      install(["null-body"]);
      const onError = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));
      await flush();

      expect(onError).toHaveBeenCalledWith(new Error("Response body is null"));
      await advance(1_000);
      expect(server.fetchMock).toHaveBeenCalledTimes(2);
    });

    it("surfaces a network failure and retries", async () => {
      install(["network-error"]);
      const onError = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));
      await flush();

      expect(onError).toHaveBeenCalledWith(new TypeError("Failed to fetch"));
      await advance(1_000);
      expect(server.fetchMock).toHaveBeenCalledTimes(2);
      expect(server.connections).toHaveLength(1);
    });

    it("wraps a non-Error rejection in an Error for onError", async () => {
      global.fetch = jest.fn().mockRejectedValue("boom") as unknown as typeof fetch;
      const onError = jest.fn();
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));
      await flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
      expect(onError.mock.calls[0][0].message).toBe("boom");
    });

    it("resets the backoff after a successful connection", async () => {
      // fail once (1s retry), connect, then the server closes cleanly.
      install([{ status: 500, statusText: "Internal Server Error" }, "open"]);
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));
      await flush();

      await advance(1_000); // retry succeeds and opens a connection
      expect(server.connections).toHaveLength(1);
      server.connections[0].close();
      await flush();
      expect(server.fetchMock).toHaveBeenCalledTimes(2);

      // Without the reset this reconnect would wait 2s instead of 1s.
      await advance(999);
      expect(server.fetchMock).toHaveBeenCalledTimes(2);
      await advance(1);
      expect(server.fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // ─── fallback polling ────────────────────────────────────────────────────

  describe("fallback polling", () => {
    const fail = (n: number): Step[] =>
      Array.from({ length: n }, () => ({ status: 500, statusText: "Internal Server Error" }));

    it("switches to polling after three failures and polls at the default 30s interval", async () => {
      install(fail(3));
      const onFallbackPoll = jest.fn();
      const { result } = renderHook(() =>
        useSSE({ url: URL_A, onMessage: jest.fn(), onFallbackPoll }),
      );

      await advance(3_000); // 3 attempts: t=0, t=1s, t=3s
      expect(result.current).toBe("polling");
      expect(onFallbackPoll).toHaveBeenCalledTimes(1); // immediate poll

      await advance(29_999);
      expect(onFallbackPoll).toHaveBeenCalledTimes(1);
      await advance(1);
      expect(onFallbackPoll).toHaveBeenCalledTimes(2);
      await advance(30_000);
      expect(onFallbackPoll).toHaveBeenCalledTimes(3);
    });

    it("honours a custom polling interval", async () => {
      install(fail(3));
      const onFallbackPoll = jest.fn();
      renderHook(() =>
        useSSE({ url: URL_A, onMessage: jest.fn(), onFallbackPoll, pollingInterval: 5_000 }),
      );

      await advance(3_000);
      expect(onFallbackPoll).toHaveBeenCalledTimes(1);
      await advance(5_000);
      expect(onFallbackPoll).toHaveBeenCalledTimes(2);
      await advance(10_000);
      expect(onFallbackPoll).toHaveBeenCalledTimes(4);
    });

    it("never enters polling mode when no fallback handler is provided", async () => {
      install(fail(3));
      const { result } = renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));

      await advance(120_000);
      expect(result.current).not.toBe("polling");
      expect(server.fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps reconnecting after clean closures because every open resets the attempt counter", async () => {
      const onFallbackPoll = jest.fn();
      const { result } = renderHook(() =>
        useSSE({ url: URL_A, onMessage: jest.fn(), onFallbackPoll }),
      );
      await flush();

      for (let cycle = 0; cycle < 4; cycle += 1) {
        server.connections[cycle].close();
        await advance(1_000);
      }

      // A stream that opens and then closes is not a failed attempt, so the
      // hook never reaches the three-failure cap and never starts polling.
      expect(server.fetchMock).toHaveBeenCalledTimes(5);
      expect(result.current).not.toBe("polling");
      expect(onFallbackPoll).not.toHaveBeenCalled();
    });
  });

  // ─── cleanup ─────────────────────────────────────────────────────────────

  describe("cleanup", () => {
    it("aborts the in-flight stream on unmount without reporting an error", async () => {
      const onError = jest.fn();
      const { unmount } = renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn(), onError }));
      await flush();

      unmount();
      await flush();

      expect(server.connections[0].signal.aborted).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it("does not reconnect after unmount, even once the backoff timer would have fired", async () => {
      renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() })).unmount();
      await advance(60_000);

      expect(server.fetchMock.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it("cancels a pending backoff timer on unmount", async () => {
      install([{ status: 500, statusText: "Internal Server Error" }]);
      const { unmount } = renderHook(() => useSSE({ url: URL_A, onMessage: jest.fn() }));
      await flush();
      expect(server.fetchMock).toHaveBeenCalledTimes(1);

      unmount(); // the 1s retry is still pending
      await advance(60_000);

      expect(server.fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops fallback polling on unmount", async () => {
      install(
        Array.from({ length: 3 }, () => ({ status: 500, statusText: "Internal Server Error" })),
      );
      const onFallbackPoll = jest.fn();
      const { unmount } = renderHook(() =>
        useSSE({ url: URL_A, onMessage: jest.fn(), onFallbackPoll }),
      );
      await advance(3_000);
      expect(onFallbackPoll).toHaveBeenCalledTimes(1);

      unmount();
      await advance(120_000);

      expect(onFallbackPoll).toHaveBeenCalledTimes(1);
    });

    it("stops delivering messages from a stream that was torn down", async () => {
      const onMessage = jest.fn();
      const { unmount } = renderHook(() => useSSE({ url: URL_A, onMessage }));
      await flush();
      const connection = server.connections[0];

      unmount();
      connection.send({ late: true });
      await flush();

      expect(onMessage).not.toHaveBeenCalled();
    });
  });
});
