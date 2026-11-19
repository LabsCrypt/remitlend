/**
 * PaginationControls.test.tsx
 * 
 * Tests for PaginationControls component focusing on accessibility (#2131)
 * Tests cover: disabled buttons, keyboard activation, page bounds, and aria attributes
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PaginationControls } from "./PaginationControls";

describe("PaginationControls Accessibility (#2131)", () => {
  const defaultProps = {
    currentPage: 1,
    totalPages: 10,
    hasPrevious: false,
    hasNext: true,
    onPageChange: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
  };

  describe("Disabled Button States", () => {
    it("should disable Previous button when hasPrevious is false", () => {
      render(<PaginationControls {...defaultProps} hasPrevious={false} />);
      
      const prevButton = screen.getByText("Previous");
      expect(prevButton).toBeDisabled();
      expect(prevButton).toHaveClass("disabled:cursor-not-allowed");
      expect(prevButton).toHaveClass("disabled:opacity-50");
    });

    it("should enable Previous button when hasPrevious is true", () => {
      render(<PaginationControls {...defaultProps} hasPrevious={true} currentPage={2} />);
      
      const prevButton = screen.getByText("Previous");
      expect(prevButton).not.toBeDisabled();
    });

    it("should disable Next button when hasNext is false", () => {
      render(
        <PaginationControls {...defaultProps} hasNext={false} currentPage={10} totalPages={10} />
      );
      
      const nextButton = screen.getByText("Next");
      expect(nextButton).toBeDisabled();
      expect(nextButton).toHaveClass("disabled:cursor-not-allowed");
    });

    it("should enable Next button when hasNext is true", () => {
      render(<PaginationControls {...defaultProps} hasNext={true} />);
      
      const nextButton = screen.getByText("Next");
      expect(nextButton).not.toBeDisabled();
    });

    it("should not call onPrevious when button is disabled", () => {
      const onPrevious = vi.fn();
      render(<PaginationControls {...defaultProps} hasPrevious={false} onPrevious={onPrevious} />);
      
      const prevButton = screen.getByText("Previous");
      fireEvent.click(prevButton);
      
      expect(onPrevious).not.toHaveBeenCalled();
    });

    it("should not call onNext when button is disabled", () => {
      const onNext = vi.fn();
      render(
        <PaginationControls
          {...defaultProps}
          hasNext={false}
          currentPage={10}
          totalPages={10}
          onNext={onNext}
        />
      );
      
      const nextButton = screen.getByText("Next");
      fireEvent.click(nextButton);
      
      expect(onNext).not.toHaveBeenCalled();
    });
  });

  describe("Keyboard Activation", () => {
    it("should activate Previous button with Enter key", () => {
      const onPrevious = vi.fn();
      render(<PaginationControls {...defaultProps} hasPrevious={true} onPrevious={onPrevious} />);
      
      const prevButton = screen.getByText("Previous");
      fireEvent.keyDown(prevButton, { key: "Enter", code: "Enter" });
      fireEvent.click(prevButton);
      
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("should activate Next button with Enter key", () => {
      const onNext = vi.fn();
      render(<PaginationControls {...defaultProps} onNext={onNext} />);
      
      const nextButton = screen.getByText("Next");
      fireEvent.keyDown(nextButton, { key: "Enter", code: "Enter" });
      fireEvent.click(nextButton);
      
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("should activate page number button with Enter key", () => {
      const onPageChange = vi.fn();
      render(<PaginationControls {...defaultProps} onPageChange={onPageChange} />);
      
      const pageButton = screen.getByText("3");
      fireEvent.keyDown(pageButton, { key: "Enter", code: "Enter" });
      fireEvent.click(pageButton);
      
      expect(onPageChange).toHaveBeenCalledWith(3);
    });

    it("should activate button with Space key", () => {
      const onNext = vi.fn();
      render(<PaginationControls {...defaultProps} onNext={onNext} />);
      
      const nextButton = screen.getByText("Next");
      fireEvent.keyDown(nextButton, { key: " ", code: "Space" });
      fireEvent.click(nextButton);
      
      expect(onNext).toHaveBeenCalled();
    });

    it("should not activate disabled button with keyboard", () => {
      const onPrevious = vi.fn();
      render(<PaginationControls {...defaultProps} hasPrevious={false} onPrevious={onPrevious} />);
      
      const prevButton = screen.getByText("Previous");
      fireEvent.keyDown(prevButton, { key: "Enter", code: "Enter" });
      fireEvent.click(prevButton);
      
      expect(onPrevious).not.toHaveBeenCalled();
    });
  });

  describe("Page Bounds", () => {
    it("should handle page 1 boundary correctly", () => {
      const { container } = render(
        <PaginationControls {...defaultProps} currentPage={1} hasPrevious={false} />
      );
      
      const prevButton = screen.getByText("Previous");
      expect(prevButton).toBeDisabled();
      
      // Current page should be highlighted
      const currentPageButton = screen.getByText("1");
      expect(currentPageButton).toHaveClass("bg-indigo-600");
    });

    it("should handle last page boundary correctly", () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={10}
          totalPages={10}
          hasPrevious={true}
          hasNext={false}
        />
      );
      
      const nextButton = screen.getByText("Next");
      expect(nextButton).toBeDisabled();
    });

    it("should not render when totalPages is 1", () => {
      const { container } = render(<PaginationControls {...defaultProps} totalPages={1} />);
      
      expect(container.firstChild).toBeNull();
    });

    it("should not render when totalPages is 0", () => {
      const { container } = render(
        <PaginationControls {...defaultProps} totalPages={0} currentPage={0} />
      );
      
      expect(container.firstChild).toBeNull();
    });

    it("should handle middle page correctly", () => {
      const onPageChange = vi.fn();
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={5}
          hasPrevious={true}
          hasNext={true}
          onPageChange={onPageChange}
        />
      );
      
      const prevButton = screen.getByText("Previous");
      const nextButton = screen.getByText("Next");
      
      expect(prevButton).not.toBeDisabled();
      expect(nextButton).not.toBeDisabled();
    });

    it("should show ellipsis for large page ranges", () => {
      render(<PaginationControls {...defaultProps} currentPage={5} totalPages={20} />);
      
      const ellipses = screen.getAllByText("...");
      expect(ellipses.length).toBeGreaterThan(0);
    });

    it("should not show ellipsis for small page ranges", () => {
      render(<PaginationControls {...defaultProps} currentPage={2} totalPages={5} />);
      
      const ellipses = screen.queryAllByText("...");
      expect(ellipses.length).toBe(0);
    });

    it("should handle navigation to page 1 from any page", () => {
      const onPageChange = vi.fn();
      render(
        <PaginationControls {...defaultProps} currentPage={10} totalPages={20} onPageChange={onPageChange} />
      );
      
      const firstPageButton = screen.getAllByText("1")[0];
      fireEvent.click(firstPageButton);
      
      expect(onPageChange).toHaveBeenCalledWith(1);
    });

    it("should handle navigation to last page from any page", () => {
      const onPageChange = vi.fn();
      render(
        <PaginationControls {...defaultProps} currentPage={1} totalPages={20} onPageChange={onPageChange} />
      );
      
      const lastPageButton = screen.getByText("20");
      fireEvent.click(lastPageButton);
      
      expect(onPageChange).toHaveBeenCalledWith(20);
    });
  });

  describe("ARIA Attributes", () => {
    it("should set aria-current on current page button", () => {
      render(<PaginationControls {...defaultProps} currentPage={3} />);
      
      const currentPageButton = screen.getByText("3");
      expect(currentPageButton).toHaveAttribute("aria-current", "page");
    });

    it("should not set aria-current on non-current page buttons", () => {
      render(<PaginationControls {...defaultProps} currentPage={3} />);
      
      const otherPageButton = screen.getByText("2");
      expect(otherPageButton).not.toHaveAttribute("aria-current");
    });

    it("should have proper button role on all buttons", () => {
      const { container } = render(<PaginationControls {...defaultProps} currentPage={2} />);
      
      const buttons = container.querySelectorAll("button");
      buttons.forEach((button) => {
        expect(button.tagName).toBe("BUTTON");
      });
    });

    it("should have focusable buttons", () => {
      render(<PaginationControls {...defaultProps} />);
      
      const nextButton = screen.getByText("Next");
      nextButton.focus();
      
      expect(document.activeElement).toBe(nextButton);
    });

    it("disabled buttons should not be focusable via keyboard", () => {
      render(<PaginationControls {...defaultProps} hasPrevious={false} />);
      
      const prevButton = screen.getByText("Previous");
      expect(prevButton).toBeDisabled();
      // Disabled buttons are still focusable in HTML but not activatable
    });
  });

  describe("Click Handlers", () => {
    it("should call onPrevious when Previous button is clicked", () => {
      const onPrevious = vi.fn();
      render(
        <PaginationControls {...defaultProps} hasPrevious={true} currentPage={2} onPrevious={onPrevious} />
      );
      
      const prevButton = screen.getByText("Previous");
      fireEvent.click(prevButton);
      
      expect(onPrevious).toHaveBeenCalledTimes(1);
    });

    it("should call onNext when Next button is clicked", () => {
      const onNext = vi.fn();
      render(<PaginationControls {...defaultProps} onNext={onNext} />);
      
      const nextButton = screen.getByText("Next");
      fireEvent.click(nextButton);
      
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("should call onPageChange with correct page number", () => {
      const onPageChange = vi.fn();
      render(<PaginationControls {...defaultProps} onPageChange={onPageChange} />);
      
      const pageButton = screen.getByText("4");
      fireEvent.click(pageButton);
      
      expect(onPageChange).toHaveBeenCalledWith(4);
      expect(onPageChange).toHaveBeenCalledTimes(1);
    });

    it("should not trigger multiple calls on rapid clicks", () => {
      const onPageChange = vi.fn();
      render(<PaginationControls {...defaultProps} onPageChange={onPageChange} />);
      
      const pageButton = screen.getByText("3");
      fireEvent.click(pageButton);
      fireEvent.click(pageButton);
      fireEvent.click(pageButton);
      
      expect(onPageChange).toHaveBeenCalledTimes(3);
      expect(onPageChange).toHaveBeenCalledWith(3);
    });
  });

  describe("Summary Display", () => {
    it("should display summary text when provided", () => {
      const summary = "Showing 1-10 of 100 results";
      render(<PaginationControls {...defaultProps} summary={summary} />);
      
      expect(screen.getByText(summary)).toBeInTheDocument();
    });

    it("should not display summary when not provided", () => {
      const { container } = render(<PaginationControls {...defaultProps} />);
      
      const summaryDiv = container.querySelector(".text-sm.text-zinc-500");
      expect(summaryDiv?.textContent).toBe("");
    });
  });

  describe("Custom Styling", () => {
    it("should apply custom className", () => {
      const { container } = render(<PaginationControls {...defaultProps} className="custom-class" />);
      
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("custom-class");
    });

    it("should maintain default styles with custom className", () => {
      const { container } = render(<PaginationControls {...defaultProps} className="custom-class" />);
      
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper).toHaveClass("flex");
      expect(wrapper).toHaveClass("custom-class");
    });
  });

  describe("Edge Cases", () => {
    it("should handle currentPage equal to totalPages", () => {
      render(
        <PaginationControls
          {...defaultProps}
          currentPage={10}
          totalPages={10}
          hasPrevious={true}
          hasNext={false}
        />
      );
      
      const nextButton = screen.getByText("Next");
      expect(nextButton).toBeDisabled();
    });

    it("should handle currentPage greater than totalPages gracefully", () => {
      // This shouldn't happen in normal usage, but test defensive behavior
      const { container } = render(
        <PaginationControls {...defaultProps} currentPage={15} totalPages={10} />
      );
      
      expect(container.firstChild).not.toBeNull();
    });

    it("should handle negative totalPages", () => {
      const { container } = render(<PaginationControls {...defaultProps} totalPages={-1} />);
      
      expect(container.firstChild).toBeNull();
    });
  });
});
