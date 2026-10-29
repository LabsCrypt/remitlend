import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type CronCallback = () => Promise<void>;
let capturedCallback: CronCallback | null = null;
const mockScheduleStop = jest.fn();

const mockQuery = jest.fn<() => Promise<{ rows: any[] }>>();
const mockCreateNotification = jest.fn<() => Promise<any>>();
const mockRecordSuccess = jest.fn();
const mockRecordFailure = jest.fn();

jest.unstable_mockModule('node-cron', () => ({
  default: {
    schedule: (_pattern: string, cb: CronCallback) => {
      capturedCallback = cb;
      return { stop: mockScheduleStop };
    },
  },
}));

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('../../services/notificationService.js', () => ({
  notificationService: {
    createNotification: mockCreateNotification,
  },
}));

jest.unstable_mockModule('../../services/jobMetricsService.js', () => ({
  jobMetricsService: {
    recordSuccess: mockRecordSuccess,
    recordFailure: mockRecordFailure,
  },
}));

const { startLoanDueCheckCron, stopLoanDueCheckCron } = await import('../loanCheckCron.js');

describe('loanDueCheckCron (#2028, #2116)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopLoanDueCheckCron();
    capturedCallback = null;
  });

  describe('success path', () => {
    it('queries for loans due soon with exclusions and formats amount in non-stroop units', async () => {
      startLoanDueCheckCron();
      expect(capturedCallback).toBeDefined();

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            loan_id: 42,
            address: 'GBORROWER123',
            amount: '50000000', // 50 million stroops = 5 units
          },
        ],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);

      await capturedCallback!();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const querySql = (mockQuery.mock.calls[0] as unknown[])[0] as string;

      // Must exclude defaulted / liquidated loans
      expect(querySql).toContain('LoanDefaulted');
      expect(querySql).toContain('LoanLiquidated');
      expect(querySql).toContain('CollateralLiquidated');

      // Must deduplicate notifications within 24 hours
      expect(querySql).toContain("n.type = 'repayment_due'");
      expect(querySql).toContain("INTERVAL '24 hours'");

      // Notification must format stroops as loan amount (divided by 10_000_000)
      expect(mockCreateNotification).toHaveBeenCalledWith({
        userId: 'GBORROWER123',
        type: 'repayment_due',
        title: 'Repayment Due Soon',
        message: 'Your repayment for loan #42 of 5 is due.',
        loanId: 42,
      });
      expect(mockRecordSuccess).toHaveBeenCalledWith('loanDueCheckCron', expect.any(Number));
    });

    it('handles multiple loans in a single run', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({
        rows: [
          { loan_id: 1, address: 'GADDR1', amount: '10000000' },
          { loan_id: 2, address: 'GADDR2', amount: '20000000' },
          { loan_id: 3, address: 'GADDR3', amount: '30000000' },
        ],
      });
      mockCreateNotification.mockResolvedValue(undefined);

      await capturedCallback!();

      expect(mockCreateNotification).toHaveBeenCalledTimes(3);
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          loanId: 1,
          userId: 'GADDR1',
          message: expect.stringContaining('1'),
        }),
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          loanId: 2,
          userId: 'GADDR2',
          message: expect.stringContaining('2'),
        }),
      );
      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          loanId: 3,
          userId: 'GADDR3',
          message: expect.stringContaining('3'),
        }),
      );
      expect(mockRecordSuccess).toHaveBeenCalledWith('loanDueCheckCron', expect.any(Number));
    });

    it('handles empty result set gracefully', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({ rows: [] });

      await capturedCallback!();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockCreateNotification).not.toHaveBeenCalled();
      expect(mockRecordSuccess).toHaveBeenCalledWith('loanDueCheckCron', expect.any(Number));
    });
  });

  describe('failure path', () => {
    it('records failure when query throws', async () => {
      startLoanDueCheckCron();

      const dbError = new Error('Database connection failed');
      mockQuery.mockRejectedValueOnce(dbError);

      await capturedCallback!();

      expect(mockRecordFailure).toHaveBeenCalledWith(
        'loanDueCheckCron',
        dbError,
        expect.any(Number),
      );
      expect(mockRecordSuccess).not.toHaveBeenCalled();
    });

    it('records failure when notification creation throws', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 42, address: 'GBORROWER123', amount: '50000000' }],
      });
      const notificationError = new Error('Notification service unavailable');
      mockCreateNotification.mockRejectedValueOnce(notificationError);

      await capturedCallback!();

      expect(mockRecordFailure).toHaveBeenCalledWith(
        'loanDueCheckCron',
        notificationError,
        expect.any(Number),
      );
      expect(mockRecordSuccess).not.toHaveBeenCalled();
    });

    it('records failure for individual notification failures but continues processing', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({
        rows: [
          { loan_id: 1, address: 'GADDR1', amount: '10000000' },
          { loan_id: 2, address: 'GADDR2', amount: '20000000' },
        ],
      });
      mockCreateNotification
        .mockResolvedValueOnce(undefined) // first succeeds
        .mockRejectedValueOnce(new Error('Failed for loan 2')); // second fails

      await capturedCallback!();

      // Should have attempted both notifications
      expect(mockCreateNotification).toHaveBeenCalledTimes(2);
      // Should record failure
      expect(mockRecordFailure).toHaveBeenCalledWith(
        'loanDueCheckCron',
        expect.any(Error),
        expect.any(Number),
      );
    });
  });

  describe('overlap prevention (#2116)', () => {
    it('skips execution when a previous run is still in flight', async () => {
      startLoanDueCheckCron();
      const callback = capturedCallback!;

      // Mock a slow query - returns a promise we can control
      let resolveQuery: (value: { rows: any[] }) => void;
      const queryPromise = new Promise<{ rows: any[] }>((resolve) => {
        resolveQuery = resolve;
      });
      mockQuery.mockReturnValueOnce(queryPromise);
      mockCreateNotification.mockResolvedValue(undefined);

      // Start first run (it will await the query promise)
      const firstRunPromise = callback();

      // Give the first run a moment to set inFlight = true and hit the await
      await new Promise((resolve) => setImmediate(resolve));

      // Now immediately try to run again while first is still in flight
      await callback(); // This should return early due to inFlight check

      // Resolve the first query
      resolveQuery!({ rows: [{ loan_id: 1, address: 'GADDR', amount: '10000000' }] });
      await firstRunPromise;

      // Query should only have been called once (by the first run)
      expect(mockQuery).toHaveBeenCalledTimes(1);
      // Notification should only have been called once
      expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    });

    it('allows a new run after the previous one completes', async () => {
      startLoanDueCheckCron();
      const callback = capturedCallback!;

      // First run
      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 1, address: 'GADDR1', amount: '10000000' }],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);
      await callback();

      // Second run (after first completes)
      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 2, address: 'GADDR2', amount: '20000000' }],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);
      await callback();

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockCreateNotification).toHaveBeenCalledTimes(2);
      expect(mockRecordSuccess).toHaveBeenCalledTimes(2);
    });
  });

  describe('duplicate notification prevention', () => {
    it('does not notify for loans already notified within 24 hours (query-level dedup)', async () => {
      startLoanDueCheckCron();

      // The query itself excludes loans with recent notifications
      // This test verifies the query includes the 24h check
      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 1, address: 'GADDR', amount: '10000000' }],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);

      await capturedCallback!();

      const querySql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      expect(querySql).toContain("n.type = 'repayment_due'");
      expect(querySql).toContain("INTERVAL '24 hours'");
      expect(querySql).toContain('NOT EXISTS');
    });

    it('handles loan that was already defaulted (excluded by query)', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({ rows: [] }); // Defaulted loans excluded by query
      mockCreateNotification.mockResolvedValue(undefined);

      await capturedCallback!();

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('handles loan that was already liquidated (excluded by query)', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockCreateNotification.mockResolvedValue(undefined);

      await capturedCallback!();

      const querySql = (mockQuery.mock.calls[0] as unknown[])[0] as string;
      expect(querySql).toContain('LoanLiquidated');
      expect(querySql).toContain('CollateralLiquidated');
    });
  });

  describe('boundary conditions', () => {
    it('stops the cron correctly', () => {
      // Fresh start for this test
      stopLoanDueCheckCron();
      capturedCallback = null;
      jest.clearAllMocks();
      mockScheduleStop.mockClear();

      startLoanDueCheckCron();
      expect(capturedCallback).toBeDefined();

      stopLoanDueCheckCron();

      expect(mockScheduleStop).toHaveBeenCalledTimes(1);
    });

    it('does not double-schedule if start is called twice', () => {
      startLoanDueCheckCron();
      const firstCallback = capturedCallback;

      startLoanDueCheckCron(); // Should not create a new task

      expect(capturedCallback).toBe(firstCallback);
      expect(mockScheduleStop).not.toHaveBeenCalled(); // The original task is still there
    });

    it('handles very large loan amounts correctly', async () => {
      startLoanDueCheckCron();

      // Test with a large amount (e.g., 1000 units = 10_000_000_000 stroops)
      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 999, address: 'GWHALE', amount: '10000000000' }],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);

      await capturedCallback!();

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Your repayment for loan #999 of 1000 is due.',
        }),
      );
    });

    it('handles zero amount edge case', async () => {
      startLoanDueCheckCron();

      mockQuery.mockResolvedValueOnce({
        rows: [{ loan_id: 0, address: 'GADDR', amount: '0' }],
      });
      mockCreateNotification.mockResolvedValueOnce(undefined);

      await capturedCallback!();

      expect(mockCreateNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Your repayment for loan #0 of 0 is due.',
        }),
      );
    });
  });
});
