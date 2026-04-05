
import { jest } from "@jest/globals";

// Explicitly type the mocks to match the real function signatures
type Borrower = { id: string; score: number; last_repayment: string | null };
const mockGetInactiveBorrowers: jest.MockedFunction<() => Promise<Borrower[]>> = jest.fn();
const mockApplyScoreDecay: jest.MockedFunction<(b: Borrower) => Promise<number>> = jest.fn();

jest.unstable_mockModule("../../services/scoreDecayService.js", () => ({
  getInactiveBorrowers: mockGetInactiveBorrowers,
  applyScoreDecay: mockApplyScoreDecay,
}));

describe("scoreDecayJob", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should apply score decay to all inactive borrowers", async () => {
    const borrowers = [
      { id: "user1", score: 700, last_repayment: "2024-01-01T00:00:00.000Z" },
      { id: "user2", score: 650, last_repayment: null },
    ];
    mockGetInactiveBorrowers.mockResolvedValue(borrowers);
    mockApplyScoreDecay.mockResolvedValue(0);

    // Import the job after mocks
    const { default: runScoreDecayJob } = await import("../scoreDecayJob.js");
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalled();
    expect(mockApplyScoreDecay).toHaveBeenCalledTimes(borrowers.length);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[0]);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[1]);
  });

  it("should handle errors gracefully", async () => {
    mockGetInactiveBorrowers.mockRejectedValue(new Error("DB error"));
    const { default: runScoreDecayJob } = await import("../scoreDecayJob.js");
    await expect(runScoreDecayJob()).resolves.not.toThrow();
  });
});
