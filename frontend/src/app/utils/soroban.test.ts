import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./soroban.ts", import.meta.url), "utf8");

describe("buildUnsignedLoanRequestXdr", () => {
  it("passes request_loan arguments as borrower, amount, term", () => {
    expect(source).toContain("functionName: \"request_loan\"");
    expect(source).toContain("args: [borrowerScVal, amountScVal, termScVal]");
    expect(source).not.toContain("args: [borrowerScVal, termScVal, amountScVal]");
  });
});