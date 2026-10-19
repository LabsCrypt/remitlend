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

describe('loanDueCheckCron (#2028)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stopLoanDueCheckCron();
    capturedCallback = null;
  });

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
});
