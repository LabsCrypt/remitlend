/**
 * components/global_ui/DashboardShell.test.tsx
 *
 * Regression tests for the mobile sidebar drawer (#1882).
 *
 * The Sidebar was given `"... hidden lg:flex"` on top of its own `flex` base
 * class. `hidden` is unconditional, so below `lg` the panel was
 * `display:none` at every width: opening the drawer revealed the backdrop
 * while the drawer itself stayed unreachable. BottomNav masked this because it
 * is the primary mobile navigation.
 */

import { render, screen, fireEvent } from "@testing-library/react";

const mockIsDesktop = jest.fn<boolean, []>();
jest.mock("../../hooks/useMediaQuery", () => ({
  useIsDesktop: () => mockIsDesktop(),
  LG_BREAKPOINT_PX: 1024,
}));

jest.mock("./Sidebar", () => ({
  Sidebar: ({ className, inert }: { className?: string; inert?: boolean }) => (
    <aside data-testid="sidebar" data-inert={inert ? "true" : "false"} className={className}>
      Sidebar
    </aside>
  ),
}));

jest.mock("./Header", () => ({
  Header: ({ onMenuClick }: { onMenuClick?: () => void }) => (
    <button type="button" aria-label="Open navigation menu" onClick={onMenuClick}>
      menu
    </button>
  ),
}));

jest.mock("./BottomNav", () => ({ BottomNav: () => <nav data-testid="bottom-nav" /> }));
jest.mock("./Breadcrumbs", () => ({ Breadcrumbs: () => <div /> }));
jest.mock("./OfflineBanner", () => ({ OfflineBanner: () => null }));
jest.mock("./PauseBanner", () => ({ PauseBanner: () => null }));

import { DashboardShell } from "./DashboardShell";

function renderShell() {
  return render(
    <DashboardShell>
      <div>content</div>
    </DashboardShell>,
  );
}

function sidebarClasses(): string[] {
  return screen.getByTestId("sidebar").className.split(/\s+/);
}

describe("DashboardShell sidebar drawer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDesktop.mockReset();
  });

  it("does not force display:none on the sidebar below lg", () => {
    // The regression itself. `hidden` won over Sidebar's own `flex` base
    // class, so the drawer could never be shown at any mobile width.
    mockIsDesktop.mockReturnValue(false);
    renderShell();
    expect(sidebarClasses()).not.toContain("hidden");
  });

  it("parks the closed drawer off-canvas rather than hiding it", () => {
    mockIsDesktop.mockReturnValue(false);
    renderShell();
    expect(sidebarClasses()).toContain("-translate-x-full");
  });

  it("slides the drawer into view when opened", () => {
    mockIsDesktop.mockReturnValue(false);
    renderShell();
    expect(sidebarClasses()).toContain("-translate-x-full");

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(sidebarClasses()).toContain("translate-x-0");
    expect(sidebarClasses()).not.toContain("-translate-x-full");
  });

  it("shows the backdrop only while the drawer is open", () => {
    mockIsDesktop.mockReturnValue(false);
    const { container } = renderShell();
    expect(container.querySelector(".backdrop-blur-sm")).toBeNull();

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(container.querySelector(".backdrop-blur-sm")).not.toBeNull();

    fireEvent.click(container.querySelector(".backdrop-blur-sm")!);
    expect(container.querySelector(".backdrop-blur-sm")).toBeNull();
  });

  it("opens on the hamburger click and closes on backdrop click", () => {
    mockIsDesktop.mockReturnValue(false);
    const { container } = renderShell();

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(container.querySelector(".backdrop-blur-sm")).not.toBeNull();

    fireEvent.click(container.querySelector(".backdrop-blur-sm")!);
    expect(container.querySelector(".backdrop-blur-sm")).toBeNull();
  });

  it("keeps the closed drawer out of the tab order on mobile", () => {
    // Off-canvas via translate means the links are still focusable, so `inert`
    // is what stops keyboard focus walking into invisible navigation.
    mockIsDesktop.mockReturnValue(false);
    renderShell();
    expect(screen.getByTestId("sidebar").dataset.inert).toBe("true");
  });

  it("removes inert once the drawer is open", () => {
    mockIsDesktop.mockReturnValue(false);
    renderShell();
    expect(screen.getByTestId("sidebar").dataset.inert).toBe("true");

    fireEvent.click(screen.getByLabelText("Open navigation menu"));
    expect(screen.getByTestId("sidebar").dataset.inert).toBe("false");
  });

  it("never marks the docked desktop sidebar inert", () => {
    // isSidebarOpen stays false at lg, since the hamburger is `lg:hidden`.
    // Gating inert on the toggle alone would make desktop nav unreachable.
    mockIsDesktop.mockReturnValue(true);
    renderShell();
    expect(screen.getByTestId("sidebar").dataset.inert).toBe("false");
  });
});
