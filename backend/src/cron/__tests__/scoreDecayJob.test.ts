import { jest } from '@jest/globals';

// Explicitly type the mocks to match the real function signatures
type Borrower = {
  borrower: string;
  score: number;
  last_repayment: string | null;
};
const mockGetInactiveBorrowers: jest.MockedFunction<() => Promise<Borrower[]>> = jest.fn();
const mockApplyScoreDecay: jest.MockedFunction<(b: Borrower) => Promise<number>> = jest.fn();

jest.unstable_mockModule('../../services/scoreDecayService.js', () => ({
  getInactiveBorrowers: mockGetInactiveBorrowers,
  applyScoreDecay: mockApplyScoreDecay,
}));

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
}));

describe('scoreDecayJob', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should apply score decay to all inactive borrowers', async () => {
    const borrowers = [
      {
        borrower: 'user1',
        score: 700,
        last_repayment: '2024-01-01T00:00:00.000Z',
      },
      { borrower: 'user2', score: 650, last_repayment: null },
    ];
    mockGetInactiveBorrowers.mockResolvedValue(borrowers);
    mockApplyScoreDecay.mockResolvedValue(0);

    // Import the job after mocks
    const { default: runScoreDecayJob } = await import('../scoreDecayJob.js');
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalled();
    expect(mockApplyScoreDecay).toHaveBeenCalledTimes(borrowers.length);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[0]);
    expect(mockApplyScoreDecay).toHaveBeenCalledWith(borrowers[1]);
  });

  it('should handle errors gracefully', async () => {
    mockGetInactiveBorrowers.mockRejectedValue(new Error('DB error'));
    const { default: runScoreDecayJob } = await import('../scoreDecayJob.js');
    await expect(runScoreDecayJob()).resolves.not.toThrow();
  });

  it('skips an overlapping run while a previous pass is still in flight', async () => {
    let finishFirstPass!: () => void;
    mockGetInactiveBorrowers.mockReturnValueOnce(
      new Promise((resolve) => {
        finishFirstPass = () => resolve([]);
      }),
    );
    const { default: runScoreDecayJob } = await import('../scoreDecayJob.js');

    const firstPass = runScoreDecayJob();
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalledTimes(1);
    expect(mockApplyScoreDecay).not.toHaveBeenCalled();

    finishFirstPass();
    await firstPass;
  });

  it('allows a new pass once the previous one has completed', async () => {
    mockGetInactiveBorrowers.mockResolvedValue([]);
    const { default: runScoreDecayJob } = await import('../scoreDecayJob.js');

    await runScoreDecayJob();
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalledTimes(2);
  });

  it('releases the guard after an unhandled failure so the next pass runs', async () => {
    mockGetInactiveBorrowers.mockRejectedValueOnce(new Error('DB error'));
    mockGetInactiveBorrowers.mockResolvedValueOnce([]);
    const { default: runScoreDecayJob } = await import('../scoreDecayJob.js');

    await runScoreDecayJob();
    await runScoreDecayJob();

    expect(mockGetInactiveBorrowers).toHaveBeenCalledTimes(2);
  });
});
