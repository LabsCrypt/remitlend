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
  });
});
