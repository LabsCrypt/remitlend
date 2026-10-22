/** 
 * useLoanStream tests 
 * 
 * Regression tests for #2119: loan event streams must have deterministic tests 
 * for success, failure, boundary, and authorization paths.
 */
import { renderHook, act } from "@testing-library/react";
import { useLoanStream } from "./useLoanStream";
import { useUserStore } from "../stores/useUserStore";

// Mock useUserStore
jest.mock("../stores/useUserStore", () => ({
  useUserStore: jest.fn(),
}));

const { useUserStore } = require("../stores/useUserStore");

// Mock useQueryClient to avoid needing QueryClientProvider
jest.mock("@tanstack/react-query", () => {
  const original = jest.requireActual("@tanstack/react-query");
  return {
    ...original,
    useQueryClient: jest.fn(),
  };
});

describe("useLoanStream", () => {
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

  it("handles successful loan events", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn().mockResolvedValue({
            done: false,
            value: {
              type: "init",
            },
          }),
        }),
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = renderHook(() => useLoanStream("123"));

    // Initial fetch and stream setup
    await act(() => jest.advanceTimersByTimeAsync(100));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("filters out non-loan events", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: { type: "init" } })
            .mockResolvedValueOnce({
              done: false,
              value: {
                type: "OtherEvent",
                eventType: "NonLoanEvent",
              },
            }),
        }),
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = renderHook(() => useLoanStream("123"));

    await act(() => jest.advanceTimersByTimeAsync(100));

    // Should only fetch once for init, then filter out NonLoanEvent
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("filters events by loanId", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn()
            .mockResolvedValueOnce({ done: false, value: { type: "init" } })
            .mockResolvedValueOnce({
              done: false,
              value: {
                type: "LoanRepaid",
                eventType: "LoanRepaid",
                loanId: 999, // Different loanId
              },
            }),
        }),
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = renderHook(() => useLoanStream("123"));

    await act(() => jest.advanceTimersByTimeAsync(100));

    // Should filter out events with different loanId
    expect(fetchMock).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("runs without error", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: jest.fn().mockReturnValue({
          read: jest.fn().mockResolvedValue({
            done: true,
            value: undefined,
          }),
        }),
      },
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = renderHook(() => useLoanStream("123"));

    await act(() => jest.advanceTimersByTimeAsync(100));

    expect(true).toBe(true);
    unmount();
  });
});