/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { normalizeLiquidatableLoan } from "./useApi";

describe("normalizeLiquidatableLoan (#2307)", () => {
  it("preserves healthFactor: 0 without falling back to collateralRatio", () => {
    const row = {
      id: 1,
      borrower: "GB123",
      collateral: 1000,
      total_debt: 2000,
      healthFactor: 0,
      collateralRatio: 1.5,
      liquidationThreshold: 1.2,
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(1.5);
  });

  it("preserves collateralRatio: 0 without falling back to healthFactor", () => {
    const row = {
      id: 2,
      borrower: "GB123",
      collateral: 0,
      total_debt: 2000,
      healthFactor: 1.8,
      collateralRatio: 0,
      liquidationThreshold: 1.2,
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.healthFactor).toBe(1.8);
    expect(normalized.collateralRatio).toBe(0);
  });

  it("preserves string '0' as numeric 0 without fallback", () => {
    const row = {
      id: 3,
      borrower: "GB123",
      health_factor: "0",
      collateral_ratio: "1.4",
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(1.4);
  });

  it("falls back to collateralRatio when healthFactor is missing (undefined/null/'')", () => {
    const rowWithUndefined = {
      id: 4,
      borrower: "GB123",
      collateralRatio: 1.25,
    };
    expect(normalizeLiquidatableLoan(rowWithUndefined).healthFactor).toBe(1.25);

    const rowWithNull = {
      id: 5,
      borrower: "GB123",
      healthFactor: null,
      collateralRatio: 1.35,
    };
    expect(normalizeLiquidatableLoan(rowWithNull).healthFactor).toBe(1.35);

    const rowWithEmptyStr = {
      id: 6,
      borrower: "GB123",
      health: "",
      ratio: 1.45,
    };
    expect(normalizeLiquidatableLoan(rowWithEmptyStr).healthFactor).toBe(1.45);
  });

  it("falls back to healthFactor when collateralRatio is missing", () => {
    const row = {
      id: 7,
      borrower: "GB123",
      health: 0.95,
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.healthFactor).toBe(0.95);
    expect(normalized.collateralRatio).toBe(0.95);
  });

  it("defaults to 0 when both healthFactor and collateralRatio are missing", () => {
    const row = {
      id: 8,
      borrower: "GB123",
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(0);
  });

  it("correctly resolves snake_case aliases (health_factor, collateral_ratio)", () => {
    const row = {
      loan_id: 42,
      borrower_address: "GB456",
      collateral_locked: 500,
      total_owed: 1000,
      health_factor: 0,
      collateral_ratio: 0.5,
      threshold: 1.1,
      source: "contract",
    };

    const normalized = normalizeLiquidatableLoan(row);
    expect(normalized.loanId).toBe(42);
    expect(normalized.borrower).toBe("GB456");
    expect(normalized.collateral).toBe(500);
    expect(normalized.totalDebt).toBe(1000);
    expect(normalized.healthFactor).toBe(0);
    expect(normalized.collateralRatio).toBe(0.5);
    expect(normalized.liquidationThreshold).toBe(1.1);
    expect(normalized.source).toBe("contract");
  });
});
