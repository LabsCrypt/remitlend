"use client";

import * as React from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true",
  );
}

interface UseModalFocusTrapOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useModalFocusTrap({
  isOpen,
  onClose,
  containerRef,
  initialFocusRef,
}: UseModalFocusTrapOptions) {
  const triggerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frameId = requestAnimationFrame(() => {
      const explicitTarget = initialFocusRef?.current;
      if (explicitTarget) {
        explicitTarget.focus();
        return;
      }

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
        return;
      }

      containerRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(frameId);
      document.body.style.overflow = previousOverflow;

      if (triggerRef.current?.isConnected) {
        triggerRef.current.focus();
      }
    };
  }, [containerRef, initialFocusRef, isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(containerRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        containerRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, isOpen, onClose]);
}
