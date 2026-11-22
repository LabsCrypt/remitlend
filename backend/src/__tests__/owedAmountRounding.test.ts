import request from 'supertest';
import { jest } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.LOAN_MIN_SCORE = '500';
process.env.LOAN_MAX_AMOUNT = '50000';
process.env.LOAN_INTEREST_RATE_PERCENT = '12';
process.env.CREDIT_SCORE_THRESHOLD = '600';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

await jest.unstable_mockModule('../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest
    .fn<() => Promise<{ query: typeof mockQuery; release: jest.Mock }>>()
    .mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

const fakeCacheStore = new Map<string, unknown>();
await jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    ping: jest.fn(async () => 'ok'),
  },
}));

await jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {},
}));

await import('../app.js');
const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
  fakeCacheStore.clear();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

interface AmortizationPeriod {
  date: string;
  principalPortion: number;
  interestPortion: number;
  totalDue: number;
  runningBalance: number;
}

interface Amortization {
  principal: number;
  interestRateBps: number;
  termLedgers: number;
  totalInterest: number;
  totalDue: number;
  schedule: AmortizationPeriod[];
}

const sum = (values: number[]): number => values.reduce((acc, value) => acc + value, 0);

// Issue #1372: owed amounts used to be truncated towards zero, so the
// interest charged by the amortization preview was systematically smaller
// than the interest that was actually due.
describe('POST /api/loans/amortization-preview owed amount rounding (#1372)', () => {
  it('rounds the owed interest to the nearest cent instead of truncating it', async () => {
    // 1000.07 * 12% = 120.0084 -> must be charged as 120.01, not 120.00.
    const response = await request(app)
      .post('/api/loans/amortization-preview')
      .set(bearer('GABC123'))
      .send({ amount: 1000.07, termDays: 30 });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const amortization = response.body.amortization as Amortization;

    expect(amortization.totalInterest).toBe(120.01);
    expect(amortization.totalDue).toBe(1120.08);
  });

  it('keeps the schedule consistent with the rounded totals', async () => {
    const response = await request(app)
      .post('/api/loans/amortization-preview')
      .set(bearer('GABC123'))
      .send({ amount: 1000.07, termDays: 30 });

    const amortization = response.body.amortization as Amortization;

    expect(amortization.schedule.length).toBeGreaterThan(0);
    expect(sum(amortization.schedule.map((p) => p.principalPortion))).toBeCloseTo(
      amortization.principal,
      8,
    );
    expect(sum(amortization.schedule.map((p) => p.interestPortion))).toBeCloseTo(
      amortization.totalInterest,
      8,
    );
    expect(sum(amortization.schedule.map((p) => p.totalDue))).toBeCloseTo(amortization.totalDue, 8);

    // The loan is fully amortised: nothing is left outstanding at maturity.
    const last = amortization.schedule[amortization.schedule.length - 1]!;
    expect(last.runningBalance).toBe(0);
  });

  it('rounds every period of a multi period schedule to the nearest cent', async () => {
    // 1000.07 over 90 days -> 3 periods of 40.0028 interest each.
    const response = await request(app)
      .post('/api/loans/amortization-preview')
      .set(bearer('GABC123'))
      .send({ amount: 1000.07, termDays: 90 });

    expect(response.status).toBe(200);

    const amortization = response.body.amortization as Amortization;

    expect(amortization.totalInterest).toBe(120.01);
    expect(amortization.schedule.length).toBe(3);

    for (const period of amortization.schedule) {
      // Every period is a whole number of cents (never a truncated fraction).
      expect(period.interestPortion * 100).toBeCloseTo(Math.round(period.interestPortion * 100), 8);
    }

    // The first two periods carry the plain share (40.0028 -> 40.00) and the
    // last one absorbs the sub-cent remainder, so the schedule adds up to the
    // rounded total instead of losing the fraction.
    expect(amortization.schedule[0]!.interestPortion).toBe(40);
    expect(amortization.schedule[1]!.interestPortion).toBe(40);
    expect(amortization.schedule[2]!.interestPortion).toBe(40.01);

    expect(sum(amortization.schedule.map((p) => p.interestPortion))).toBeCloseTo(
      amortization.totalInterest,
      8,
    );
    expect(sum(amortization.schedule.map((p) => p.principalPortion))).toBeCloseTo(
      amortization.principal,
      8,
    );
  });
});
