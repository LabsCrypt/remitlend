import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreditScore } from "./useApi";
import { useUserStore } from "../stores/useUserStore";

const originalEventSource = global.EventSource;
const originalFetch = global.fetch;

class MockEventSource {
  static instances: MockEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    public readonly url: string,
    public readonly options?: EventSourceInit,
  ) {
    MockEventSource.instances.push(this);
  }

  close = jest.fn();

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function makeJsonResponse<T>(body: T): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("useCreditScore", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    global.EventSource = MockEventSource as unknown as typeof EventSource;
    act(() => {
      useUserStore.getState().setAuthToken("test-jwt");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    act(() => {
      useUserStore.getState().setAuthToken(null);
    });
    global.EventSource = originalEventSource;
    global.fetch = originalFetch;
  });

  it("fetches the wallet score and refetches after score-changing SSE events", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        makeJsonResponse({
          success: true,
          userId: "GBORROWER",
          score: 720,
          band: "Good",
          factors: {
            repaymentHistory: "On-time payments increase score by 15 pts each",
            latePaymentPenalty: "Late payments decrease score by 30 pts each",
            range: "500 (Poor) - 850 (Excellent)",
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          success: true,
          userId: "GBORROWER",
          score: 735,
          band: "Good",
          factors: {
            repaymentHistory: "On-time payments increase score by 15 pts each",
            latePaymentPenalty: "Late payments decrease score by 30 pts each",
            range: "500 (Poor) - 850 (Excellent)",
          },
        }),
      );
    global.fetch = fetchMock as typeof fetch;

    const { result } = renderHook(() => useCreditScore("GBORROWER"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.data?.score).toBe(720));
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/score/GBORROWER"),
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      MockEventSource.instances[0].emitMessage({
        eventType: "LoanRepaid",
        borrower: "GBORROWER",
      });
    });

    await waitFor(() => expect(result.current.data?.score).toBe(735));
    expect(result.current.previousScore).toBe(720);
  });
});
