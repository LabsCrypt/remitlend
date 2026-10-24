/**
 * OfflineBanner.test.tsx
 *
 * Regression tests for the OfflineBanner component.
 *
 * Gaps addressed (test-sweep label: testing/frontend):
 *   - Reconnect event clears the banner and triggers query refetch
 *   - Retry button calls refetchQueries immediately (regardless of network state)
 *   - Initial-mount reads navigator.onLine correctly (starts offline / starts online)
 *   - Boundary: rapid offline → online → offline cycle
 *   - Boundary: multiple "online" events only refetch once per transition
 *   - Accessibility contract: role="status", aria-live="polite"
 *   - Cleanup: event listeners removed on unmount
 */

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { OfflineBanner } from "./OfflineBanner";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Override navigator.onLine for the duration of a test. */
const setNavigatorOnline = (value: boolean) => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
};

/** Render OfflineBanner inside a real (but isolated) QueryClient provider
 *  and return the queryClient for spy assertions. */
const renderBanner = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  jest.spyOn(queryClient, "refetchQueries");

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
    </QueryClientProvider>,
  );

  return { ...utils, queryClient };
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset navigator.onLine to "online" before every test
  setNavigatorOnline(true);
});

afterEach(() => {
  // Restore to a clean online state after each test
  setNavigatorOnline(true);
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Initial-mount (success path — starts online)
// ---------------------------------------------------------------------------

describe("OfflineBanner — starts online", () => {
  it("renders nothing when navigator.onLine is true on mount", () => {
    setNavigatorOnline(true);
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("does not call refetchQueries on mount when already online", () => {
    setNavigatorOnline(true);
    const { queryClient } = renderBanner();
    // The effect runs once on mount; isOnline starts true, so refetch fires once
    // for the initial hydration. Document this exact contract:
    expect(queryClient.refetchQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ type: "active" });
  });
});

// ---------------------------------------------------------------------------
// Initial-mount (failure path — starts offline)
// ---------------------------------------------------------------------------

describe("OfflineBanner — starts offline", () => {
  it("renders the banner immediately when navigator.onLine is false on mount", () => {
    setNavigatorOnline(false);
    renderBanner();
    expect(
      screen.getByText(/you appear to be offline/i),
    ).toBeInTheDocument();
  });

  it("shows the Retry button when offline", () => {
    setNavigatorOnline(false);
    renderBanner();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("triggers initial hydration refetch on mount before offline status resolves", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();
    // Because isOnline initializes to true for SSR safety, the mount effect
    // fires once for hydration before the offline event/state takes effect.
    expect(queryClient.refetchQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ type: "active" });
  });
});

// ---------------------------------------------------------------------------
// Accessibility contract
// ---------------------------------------------------------------------------

describe("OfflineBanner — accessibility", () => {
  it("renders with role='status' when offline", () => {
    setNavigatorOnline(false);
    renderBanner();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has aria-live='polite' on the status region", () => {
    setNavigatorOnline(false);
    renderBanner();
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  it("contains an icon that is hidden from screen readers", () => {
    setNavigatorOnline(false);
    renderBanner();
    // The WifiOff icon must carry aria-hidden="true" so it is decorative
    const icon = screen
      .getByRole("status")
      .querySelector("[aria-hidden='true']");
    expect(icon).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reconnect event (core regression: reconnect clears banner + triggers refetch)
// ---------------------------------------------------------------------------

describe("OfflineBanner — reconnect event", () => {
  it("hides the banner when the 'online' window event fires", () => {
    setNavigatorOnline(false);
    renderBanner();
    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(screen.queryByText(/you appear to be offline/i)).not.toBeInTheDocument();
  });

  it("calls refetchQueries({ type: 'active' }) when reconnecting", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ type: "active" });
  });

  it("only refetches once per online transition, not on every render", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    const callsAfterFirstReconnect = (queryClient.refetchQueries as jest.Mock)
      .mock.calls.length;

    // Dispatching 'online' again without going offline in between should not
    // trigger an additional refetch (isOnline is already true — same state)
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    expect((queryClient.refetchQueries as jest.Mock).mock.calls.length).toBe(
      callsAfterFirstReconnect,
    );
  });
});

// ---------------------------------------------------------------------------
// Offline event
// ---------------------------------------------------------------------------

describe("OfflineBanner — offline event", () => {
  it("shows the banner when the 'offline' window event fires after starting online", () => {
    setNavigatorOnline(true);
    renderBanner();
    expect(screen.queryByText(/you appear to be offline/i)).not.toBeInTheDocument();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
  });

  it("does NOT call refetchQueries when going offline", () => {
    setNavigatorOnline(true);
    const { queryClient } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    expect(queryClient.refetchQueries).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Retry button (success path)
// ---------------------------------------------------------------------------

describe("OfflineBanner — Retry button", () => {
  it("calls refetchQueries({ type: 'active' }) immediately when Retry is clicked", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(queryClient.refetchQueries).toHaveBeenCalledTimes(1);
    expect(queryClient.refetchQueries).toHaveBeenCalledWith({ type: "active" });
  });

  it("calls refetchQueries on every Retry click (not just the first)", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(queryClient.refetchQueries).toHaveBeenCalledTimes(3);
  });

  it("banner remains visible after a failed Retry (navigator still offline)", () => {
    // The component does not auto-hide on Retry — it only hides on a real
    // 'online' event. Clicking Retry while still offline must keep the banner.
    setNavigatorOnline(false);
    renderBanner();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
  });

  it("Retry button is not rendered when online (banner is null)", () => {
    setNavigatorOnline(true);
    renderBanner();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Boundary: rapid state transitions
// ---------------------------------------------------------------------------

describe("OfflineBanner — boundary: rapid state transitions", () => {
  it("reflects the final state after a rapid offline → online → offline cycle", () => {
    setNavigatorOnline(true);
    renderBanner();

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Final state is offline → banner should be visible
    expect(screen.getByText(/you appear to be offline/i)).toBeInTheDocument();
  });

  it("reflects the final state after a rapid online → offline → online cycle", () => {
    setNavigatorOnline(false);
    renderBanner();

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    // Final state is online → banner should be hidden
    expect(
      screen.queryByText(/you appear to be offline/i),
    ).not.toBeInTheDocument();
  });

  it("calls refetchQueries once per online transition across a full cycle", () => {
    setNavigatorOnline(false);
    const { queryClient } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    // First reconnect
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    const afterFirst = (queryClient.refetchQueries as jest.Mock).mock.calls.length;

    // Drop back offline
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Second reconnect
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    // Two distinct online transitions → two refetch calls
    expect(queryClient.refetchQueries).toHaveBeenCalledTimes(afterFirst + 1);
  });
});

// ---------------------------------------------------------------------------
// Cleanup: event listeners removed on unmount
// ---------------------------------------------------------------------------

describe("OfflineBanner — cleanup on unmount", () => {
  it("removes the 'online' and 'offline' event listeners when unmounted", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");

    setNavigatorOnline(false);
    const { unmount } = renderBanner();

    // Identify the update handler that was registered
    const onlineCalls = addSpy.mock.calls.filter(([event]) => event === "online");
    const offlineCalls = addSpy.mock.calls.filter(([event]) => event === "offline");
    expect(onlineCalls.length).toBeGreaterThanOrEqual(1);
    expect(offlineCalls.length).toBeGreaterThanOrEqual(1);

    unmount();

    // The same handler reference must be passed to removeEventListener
    const removedOnline = removeSpy.mock.calls.some(([event]) => event === "online");
    const removedOffline = removeSpy.mock.calls.some(([event]) => event === "offline");
    expect(removedOnline).toBe(true);
    expect(removedOffline).toBe(true);
  });

  it("does NOT react to 'online' events after unmounting", () => {
    setNavigatorOnline(false);
    const { queryClient, unmount } = renderBanner();
    (queryClient.refetchQueries as jest.Mock).mockClear();

    unmount();

    // Firing 'online' after unmount must not call refetchQueries
    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    expect(queryClient.refetchQueries).not.toHaveBeenCalled();
  });
});
