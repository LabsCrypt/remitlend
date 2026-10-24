/**
 * components/ui/LoanTimeline.test.tsx
 *
 * Covers the presentational contract of the loan timeline:
 * - empty state
 * - every documented event label, amount formatting, and tx hash link
 * - events are rendered in the order supplied (including reverse-chronological
 *   input), so callers own chronological ordering
 * - equal timestamps keep a stable, collision-free rendering order
 * - unknown event types and missing amount/txHash degrade gracefully
 */

import { render, screen, within } from "@testing-library/react";
import { LoanTimeline } from "./LoanTimeline";
import type { LoanEvent } from "../../hooks/useApi";

const TX_HASH = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0a1b2";

const makeEvent = (overrides: Partial<LoanEvent> = {}): LoanEvent => {
  return {
    type: "LoanRequested",
    amount: "1000",
    timestamp: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
};

const items = () => {
  return screen.getAllByRole("listitem");
};

describe("LoanTimeline", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shows the empty state and renders no list when there are no events", () => {
    render(<LoanTimeline events={[]} />);

    expect(screen.getByText("No events yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("renders every documented event with its label, amount, and transaction link", () => {
    const events: LoanEvent[] = [
      makeEvent({ type: "LoanRequested", amount: "1234.5", timestamp: "2026-08-01T10:00:00.000Z" }),
      makeEvent({ type: "LoanApproved", amount: "0", timestamp: "2026-08-02T10:00:00.000Z" }),
      makeEvent({ type: "LoanRepaid", amount: "250", timestamp: "2026-08-03T10:00:00.000Z" }),
      makeEvent({ type: "LoanDefaulted", amount: "0", timestamp: "2026-08-04T10:00:00.000Z" }),
      makeEvent({ type: "Seized", amount: "0", timestamp: "2026-08-05T10:00:00.000Z" }),
    ];

    render(<LoanTimeline events={events} />);

    const labels = [
      "Loan requested",
      "Loan approved",
      "Repayment made",
      "Loan defaulted",
      "Collateral seized",
    ];
    const rendered = items();
    expect(rendered).toHaveLength(labels.length);
    labels.forEach((label, index) => {
      expect(rendered[index]).toHaveTextContent(label);
    });

    // Amounts are shown only when positive, formatted as USD.
    expect(rendered[0]).toHaveTextContent("Amount: $1,234.50");
    expect(rendered[1]).not.toHaveTextContent("Amount:");
    expect(rendered[2]).toHaveTextContent("Amount: $250.00");

    // Without a txHash no explorer link is rendered.
    expect(
      screen.queryByRole("link", { name: "View on Stellar Explorer" }),
    ).not.toBeInTheDocument();
  });

  it("renders a transaction hash link when the event has one", () => {
    render(<LoanTimeline events={[makeEvent({ type: "LoanRepaid", txHash: TX_HASH })]} />);

    const [item] = items();
    expect(
      within(item).getByText(`${TX_HASH.slice(0, 8)}...${TX_HASH.slice(-8)}`),
    ).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: "View on Stellar Explorer" })).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    );
  });

  it("preserves the supplied chronological order", () => {
    render(
      <LoanTimeline
        events={[
          makeEvent({ type: "LoanRequested", timestamp: "2026-08-01T10:00:00.000Z" }),
          makeEvent({ type: "LoanApproved", timestamp: "2026-08-02T10:00:00.000Z" }),
          makeEvent({ type: "LoanRepaid", timestamp: "2026-08-03T10:00:00.000Z" }),
        ]}
      />,
    );

    expect(items()[0]).toHaveTextContent("Loan requested");
    expect(items()[1]).toHaveTextContent("Loan approved");
    expect(items()[2]).toHaveTextContent("Repayment made");
  });

  it("renders reverse-chronological input as supplied, without re-sorting", () => {
    render(
      <LoanTimeline
        events={[
          makeEvent({ type: "LoanRepaid", timestamp: "2026-08-03T10:00:00.000Z" }),
          makeEvent({ type: "LoanApproved", timestamp: "2026-08-02T10:00:00.000Z" }),
          makeEvent({ type: "LoanRequested", timestamp: "2026-08-01T10:00:00.000Z" }),
        ]}
      />,
    );

    // The component is a pure renderer: ordering is the caller's contract, so
    // newest-first input is displayed newest-first rather than silently sorted.
    expect(items()[0]).toHaveTextContent("Repayment made");
    expect(items()[1]).toHaveTextContent("Loan approved");
    expect(items()[2]).toHaveTextContent("Loan requested");
  });

  it("renders events sharing a timestamp in a stable order with unique keys", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    render(
      <LoanTimeline
        events={[
          makeEvent({ type: "LoanRequested", timestamp: "2026-08-01T10:00:00.000Z" }),
          makeEvent({ type: "LoanApproved", timestamp: "2026-08-01T10:00:00.000Z" }),
          makeEvent({ type: "LoanRepaid", timestamp: "2026-08-01T10:00:00.000Z" }),
        ]}
      />,
    );

    const rendered = items();
    expect(rendered).toHaveLength(3);
    expect(rendered[0]).toHaveTextContent("Loan requested");
    expect(rendered[1]).toHaveTextContent("Loan approved");
    expect(rendered[2]).toHaveTextContent("Repayment made");

    // Duplicate React keys would surface as a console error; equal timestamps
    // must not produce them even though the timestamp part of the key repeats.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to the raw type and omits absent amount/tx details", () => {
    render(
      <LoanTimeline
        events={[
          makeEvent({ type: "ManualAdjustment", amount: "0" }),
          makeEvent({ type: "LoanRepaid", amount: "" }),
        ]}
      />,
    );

    const rendered = items();
    expect(rendered[0]).toHaveTextContent("ManualAdjustment");
    expect(rendered[1]).toHaveTextContent("Repayment made");
    rendered.forEach((item) => {
      expect(item).not.toHaveTextContent("Amount:");
      expect(
        within(item).queryByRole("link", { name: "View on Stellar Explorer" }),
      ).not.toBeInTheDocument();
    });
  });
});
