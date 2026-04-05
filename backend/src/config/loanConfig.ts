export interface LoanConfig {
    minScore: number;
    maxAmount: number;
    interestRatePercent: number;
    creditScoreThreshold: number;
}

export const getLoanConfig = (): LoanConfig => ({
    minScore: parseInt(process.env["MIN_CREDIT_SCORE"] ?? "600", 10),
    maxAmount: parseInt(process.env["MAX_LOAN_AMOUNT"] ?? "10000", 10),
    interestRatePercent: parseFloat(process.env["INTEREST_RATE_PERCENT"] ?? "12"),
    creditScoreThreshold: parseInt(process.env["CREDIT_SCORE_THRESHOLD"] ?? "650", 10),
});
