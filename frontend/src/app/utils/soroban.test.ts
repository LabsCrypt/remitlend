import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./soroban.ts", import.meta.url), "utf8");

describe("buildUnsignedRepaymentXdr", () => {
  it("passes repay arguments as borrower, loan id, amount", () => {
    expect(source).toContain('functionName: "repay"');
    expect(source).toContain("args: [borrowerScVal, loanIdScVal, amountScVal]");
    expect(source).not.toContain("args: [borrowerScVal, amountScVal, loanIdScVal]");
  });
});