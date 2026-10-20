import React from "react";
import { render, screen } from "@testing-library/react";
import {
  LoanHealth,
  normalizeRatio,
  getLoanHealthState,
  DEFAULT_LIQUIDATION_THRESHOLD,
  type LoanHealthData,
} from "./LoanHealth";

const mockLabels = {
  title: "Loan Health",
  loading: "Loading health factor...",
  unavailableTitle: "Health factor unavailable",
  unavailableDescription: "Unable to calculate health factor for this loan.",
  collateral: "Collateral Locked",
  totalDebt: "Total Debt",
  threshold: "Liquidation Threshold",
  sourceContract: "Smart Contract",
  sourceBackend: "Protocol Oracle",
  sourceDerived: "Derived Ratio",
  cta: "Add Collateral",
  states: {
    healthy: "Healthy",
    watch: "Watch",
    atRisk: "At Risk",
  },
  descriptions: {
    healthy: "Your collateral level is well above the liquidation threshold.",
    watch: "Your loan is approaching the danger threshold. Consider topping up.",
    atRisk: "Your position is at immediate risk of liquidation. Top up now.",
  },
};

describe("LoanHealth normalizeRatio (#1888)", () => {
  it("preserves high decimal ratios (e.g. 12.0) and does NOT divide by 100", () => {
    // A loan with 12.0 collateral ratio (1200%) must remain 12.0
    const normalized = normalizeRatio(12.0);
    expect(normalized).toBe(12.0);

    const veryHigh = normalizeRatio(25.5);
    expect(veryHigh).toBe(25.5);

    const normalDecimal = normalizeRatio(1.5);
    expect(normalDecimal).toBe(1.5);
  });

  it("converts percentage values when ratioUnit is explicitly 'percentage'", () => {
    expect(normalizeRatio(1200, "percentage")).toBe(12.0);
    expect(normalizeRatio(150, "percentage")).toBe(1.5);
    expect(normalizeRatio(125, "percentage")).toBe(1.25);
  });

  it("returns null for non-positive or invalid numbers", () => {
    expect(normalizeRatio(0)).toBeNull();
    expect(normalizeRatio(-1.5)).toBeNull();
    expect(normalizeRatio(NaN)).toBeNull();
    expect(normalizeRatio(undefined)).toBeNull();
  });
});

describe("getLoanHealthState thresholds (#1888)", () => {
  const threshold = DEFAULT_LIQUIDATION_THRESHOLD; // 1.25, dangerLine = 1.40

  it("classifies high decimal ratio 12.0 (1200%) as healthy, NOT at-risk", () => {
    expect(getLoanHealthState(12.0, threshold)).toBe("healthy");
  });

  it("classifies ratios above dangerLine as healthy", () => {
    expect(getLoanHealthState(1.5, threshold)).toBe("healthy");
    expect(getLoanHealthState(1.41, threshold)).toBe("healthy");
  });

  it("classifies ratios between threshold and dangerLine as watch", () => {
    expect(getLoanHealthState(1.4, threshold)).toBe("watch");
    expect(getLoanHealthState(1.3, threshold)).toBe("watch");
    expect(getLoanHealthState(1.26, threshold)).toBe("watch");
  });

  it("classifies ratios at or below threshold as atRisk", () => {
    expect(getLoanHealthState(1.25, threshold)).toBe("atRisk");
    expect(getLoanHealthState(1.1, threshold)).toBe("atRisk");
    expect(getLoanHealthState(0.5, threshold)).toBe("atRisk");
  });
});

describe("LoanHealth Component Integration (#1888)", () => {
  it("renders healthy state for a very safe loan with ratio 12.0 (closes #1888)", () => {
    const loan: LoanHealthData = {
      collateralLocked: 12000,
      totalOwed: 1000,
      healthFactor: 12.0, // 1200%
      liquidationThreshold: 1.25,
      healthSource: "contract",
    };

    render(<LoanHealth loan={loan} topUpHref="#top-up" labels={mockLabels} />);

    // Must show Healthy, NOT At Risk
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.queryByText("At Risk")).not.toBeInTheDocument();
    expect(screen.queryByText("Watch")).not.toBeInTheDocument();

    // Renders ratio formatted as percentage
    expect(screen.getByText("1200.0%")).toBeInTheDocument();

    // CTA button to add collateral should NOT be rendered for healthy positions
    expect(screen.queryByRole("link", { name: "Add Collateral" })).not.toBeInTheDocument();
  });

  it("renders watch state and shows top-up CTA when ratio is in danger zone", () => {
    const loan: LoanHealthData = {
      collateralLocked: 1350,
      totalOwed: 1000,
      healthFactor: 1.35,
      liquidationThreshold: 1.25,
      healthSource: "backend",
    };

    render(<LoanHealth loan={loan} topUpHref="#top-up" labels={mockLabels} />);

    expect(screen.getByText("Watch")).toBeInTheDocument();
    expect(screen.getByText("135.0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Collateral" })).toBeInTheDocument();
  });

  it("renders at-risk state when ratio is at or below liquidation threshold", () => {
    const loan: LoanHealthData = {
      collateralLocked: 1100,
      totalOwed: 1000,
      healthFactor: 1.1,
      liquidationThreshold: 1.25,
      healthSource: "contract",
    };

    render(<LoanHealth loan={loan} topUpHref="#top-up" labels={mockLabels} />);

    expect(screen.getByText("At Risk")).toBeInTheDocument();
    expect(screen.getByText("110.0%")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Collateral" })).toBeInTheDocument();
  });

  it("supports explicit ratioUnit='percentage'", () => {
    const loan: LoanHealthData = {
      collateralLocked: 2000,
      totalOwed: 1000,
      collateralRatio: 200, // 200%
      ratioUnit: "percentage",
    };

    render(<LoanHealth loan={loan} topUpHref="#top-up" labels={mockLabels} />);

    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("200.0%")).toBeInTheDocument();
  });

  it("renders loading state", () => {
    render(<LoanHealth isLoading={true} topUpHref="#top-up" labels={mockLabels} />);

    expect(screen.getByText("Loading health factor...")).toBeInTheDocument();
  });

  it("renders unavailable state when totalDebt <= 0 or isError", () => {
    render(<LoanHealth isError={true} topUpHref="#top-up" labels={mockLabels} />);

    expect(screen.getByText("Health factor unavailable")).toBeInTheDocument();
  });
});
