/**
 * Accessibility regression tests for the shared modal focus trap.
 *
 * `useModalFocusTrap` backs every modal in the app, so a regression here —
 * focus escaping the modal, or the trap never releasing on close — would break
 * keyboard accessibility everywhere at once, silently and without any visual
 * symptom.
 *
 * Two implementation details shape these tests:
 *
 *  - Initial focus is scheduled inside `requestAnimationFrame`, so assertions
 *    about it have to wait for the next frame rather than reading synchronously.
 *  - The Tab handler listens on `document` and only intervenes at the *edges*
 *    of the focusable set, letting the browser move focus in between. jsdom
 *    does not implement native Tab traversal, so the interior steps are driven
 *    explicitly with `.focus()`; the wrap-around at each edge — which is the
 *    part the hook actually owns — is asserted from the real handler.
 */

import { renderHook } from "@testing-library/react";
import * as React from "react";

import { useModalFocusTrap } from "./useModalFocusTrap";

/** Wait for the `requestAnimationFrame` that applies initial focus. */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Dispatch a Tab keydown on `document`, where the hook listens. */
function pressTab({ shift = false } = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

function pressEscape() {
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
}

interface Harness {
  container: HTMLDivElement;
  trigger: HTMLButtonElement;
  first: HTMLButtonElement;
  middle: HTMLInputElement;
  last: HTMLButtonElement;
  containerRef: React.RefObject<HTMLElement | null>;
}

/**
 * Build a trigger button plus a modal container holding three focusable
 * elements, all attached to the real document so focus actually moves.
 */
function buildHarness(): Harness {
  const trigger = document.createElement("button");
  trigger.textContent = "Open modal";
  document.body.appendChild(trigger);

  const container = document.createElement("div");
  container.tabIndex = -1;

  const first = document.createElement("button");
  first.textContent = "First";
  const middle = document.createElement("input");
  const last = document.createElement("button");
  last.textContent = "Last";

  container.append(first, middle, last);
  document.body.appendChild(container);

  return {
    container,
    trigger,
    first,
    middle,
    last,
    containerRef: { current: container } as React.RefObject<HTMLElement | null>,
  };
}

describe("useModalFocusTrap", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = buildHarness();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  // ── Tab cycling stays inside the modal ────────────────────────────────────

  it("moves focus to the first focusable element when opened", async () => {
    const { containerRef, first } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));

    await nextFrame();

    expect(document.activeElement).toBe(first);
  });

  it("honours an explicit initial focus target", async () => {
    const { containerRef, middle } = harness;
    const initialFocusRef = { current: middle } as React.RefObject<HTMLElement | null>;

    renderHook(() =>
      useModalFocusTrap({
        isOpen: true,
        onClose: jest.fn(),
        containerRef,
        initialFocusRef,
      }),
    );

    await nextFrame();

    expect(document.activeElement).toBe(middle);
  });

  it("wraps Tab from the last element back to the first", async () => {
    const { containerRef, first, last } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    last.focus();
    const event = pressTab();

    // The hook must both stop the browser's default move *and* redirect focus;
    // preventing default alone would strand focus on the last element.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first element back to the last", async () => {
    const { containerRef, first, last } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    first.focus();
    const event = pressTab({ shift: true });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
  });

  it("leaves interior Tab presses to the browser", async () => {
    const { containerRef, middle } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    middle.focus();
    const event = pressTab();

    // Hijacking every Tab would break the natural order and any nested widget
    // that handles its own arrow/Tab navigation.
    expect(event.defaultPrevented).toBe(false);
  });

  it("keeps focus inside across a full forward cycle", async () => {
    const { containerRef, first, middle, last } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    // jsdom does not move focus on Tab, so interior steps are simulated; the
    // edge wrap is the hook's own behaviour.
    expect(document.activeElement).toBe(first);
    middle.focus();
    last.focus();
    pressTab();

    expect(document.activeElement).toBe(first);
    expect(harness.container.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus inside across a full backward cycle", async () => {
    const { containerRef, first, middle, last } = harness;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    first.focus();
    pressTab({ shift: true });
    expect(document.activeElement).toBe(last);

    middle.focus();
    first.focus();
    pressTab({ shift: true });

    expect(document.activeElement).toBe(last);
    expect(harness.container.contains(document.activeElement)).toBe(true);
  });

  it("holds focus on the container when nothing inside is focusable", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const container = document.createElement("div");
    container.tabIndex = -1;
    container.textContent = "Nothing focusable here";
    document.body.appendChild(container);

    const containerRef = { current: container } as React.RefObject<HTMLElement | null>;
    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    const event = pressTab();

    // An empty modal must still not leak focus back to the page behind it.
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(container);
  });

  it("skips disabled and aria-hidden elements when choosing the edges", async () => {
    const { containerRef, container, first, last } = harness;

    const disabled = document.createElement("button");
    disabled.disabled = true;
    const hidden = document.createElement("button");
    hidden.setAttribute("aria-hidden", "true");
    container.append(disabled, hidden);

    renderHook(() => useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }));
    await nextFrame();

    // `last` must still be treated as the final stop, or Tab would wrap onto
    // an element a screen reader and the browser both ignore.
    last.focus();
    pressTab();

    expect(document.activeElement).toBe(first);
  });

  // ── Focus returns to the trigger on close ─────────────────────────────────

  it("returns focus to the triggering element when closed", async () => {
    const { containerRef, trigger, first } = harness;
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = renderHook(
      ({ isOpen }) => useModalFocusTrap({ isOpen, onClose: jest.fn(), containerRef }),
      { initialProps: { isOpen: true } },
    );
    await nextFrame();
    expect(document.activeElement).toBe(first);

    rerender({ isOpen: false });

    // Losing the trigger strands a keyboard user at the top of the document.
    expect(document.activeElement).toBe(trigger);
  });

  it("returns focus to the trigger when the hook unmounts", async () => {
    const { containerRef, trigger } = harness;
    trigger.focus();

    const { unmount } = renderHook(() =>
      useModalFocusTrap({ isOpen: true, onClose: jest.fn(), containerRef }),
    );
    await nextFrame();

    unmount();

    expect(document.activeElement).toBe(trigger);
  });

  it("does not throw when the trigger has left the DOM", async () => {
    const { containerRef, trigger } = harness;
    trigger.focus();

    const { rerender } = renderHook(
      ({ isOpen }) => useModalFocusTrap({ isOpen, onClose: jest.fn(), containerRef }),
      { initialProps: { isOpen: true } },
    );
    await nextFrame();

    // A modal that removes its own trigger (e.g. a delete confirmation) must
    // still close cleanly rather than throwing on a detached node.
    trigger.remove();
    expect(() => rerender({ isOpen: false })).not.toThrow();
  });

  // ── Scroll lock ───────────────────────────────────────────────────────────

  it("locks body scroll while open and restores it on close", async () => {
    const { containerRef } = harness;
    document.body.style.overflow = "auto";

    const { rerender } = renderHook(
      ({ isOpen }) => useModalFocusTrap({ isOpen, onClose: jest.fn(), containerRef }),
      { initialProps: { isOpen: true } },
    );
    await nextFrame();
    expect(document.body.style.overflow).toBe("hidden");

    rerender({ isOpen: false });

    // Restores the previous value rather than clearing it, so a page that was
    // already scroll-locked stays that way.
    expect(document.body.style.overflow).toBe("auto");
  });

  // ── Escape and inactive state ─────────────────────────────────────────────

  it("calls onClose when Escape is pressed", async () => {
    const { containerRef } = harness;
    const onClose = jest.fn();

    renderHook(() => useModalFocusTrap({ isOpen: true, onClose, containerRef }));
    await nextFrame();

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing at all while closed", async () => {
    const { containerRef, trigger } = harness;
    const onClose = jest.fn();
    trigger.focus();

    renderHook(() => useModalFocusTrap({ isOpen: false, onClose, containerRef }));
    await nextFrame();

    pressEscape();
    const event = pressTab();

    // A closed modal must not steal focus, swallow Tab, or lock scrolling.
    expect(onClose).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("stops listening once closed", async () => {
    const { containerRef } = harness;
    const onClose = jest.fn();

    const { rerender } = renderHook(
      ({ isOpen }) => useModalFocusTrap({ isOpen, onClose, containerRef }),
      { initialProps: { isOpen: true } },
    );
    await nextFrame();

    rerender({ isOpen: false });
    pressEscape();

    // A trap that never releases its listener keeps firing for every later
    // Escape on the page.
    expect(onClose).not.toHaveBeenCalled();
  });
});
