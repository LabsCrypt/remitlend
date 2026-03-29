import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "./ErrorBoundary";

// A helper component that throws an error on render
function ProblemChild(): React.ReactNode {
  throw new Error("Test error");
}

// A helper component that renders normally
function GoodChild() {
  return <div>Everything is fine</div>;
}

describe("ErrorBoundary", () => {
  // Suppress React's default error logging during these tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
  });
  afterEach(() => {
    console.error = originalConsoleError;
  });

  it("renders children when there is no error", () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Everything is fine")).toBeInTheDocument();
  });

  it("renders fallback UI when a child throws an error", () => {
    render(
      <ErrorBoundary scope="analytics dashboard" variant="section">
        <ProblemChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Try Again")).toBeInTheDocument();
    expect(
      screen.getByText(/analytics dashboard hit an unexpected runtime error/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Report this issue" })).toHaveAttribute(
      "href",
      "https://github.com/LabsCrypt/remitlend/issues/new",
    );
    expect(screen.getByText("Test error")).toBeInTheDocument();
  });

  it("resets error state when Try Again is clicked", () => {
    let shouldThrow = true;

    function ConditionalChild(): React.ReactNode {
      if (shouldThrow) {
        throw new Error("Conditional error");
      }
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalChild />
      </ErrorBoundary>,
    );

    // Fallback should be showing
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    // Fix the error and click Try Again
    shouldThrow = false;
    fireEvent.click(screen.getByText("Try Again"));

    // Children should render again
    expect(screen.getByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("logs the error via console.error", () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      "ErrorBoundary caught an error:",
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) }),
    );
  });
});
