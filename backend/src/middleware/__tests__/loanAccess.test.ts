import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { requireLoanOwner, requireLoanBorrowerAccess } = await import('../loanAccess.js');
const { AppError } = await import('../../errors/AppError.js');
const { ErrorCode } = await import('../../errors/errorCodes.js');

const OWNER_PK = 'GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ATTACKER_PK = 'GATTACKERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function runRequireLoanOwner(req: Partial<Request>): Promise<{
  next: jest.Mock;
  error: unknown;
}> {
  let settle!: (value: unknown) => void;
  const done = new Promise((resolve) => {
    settle = resolve;
  });

  const next = jest.fn((err?: unknown) => {
    settle(err);
  }) as unknown as NextFunction & jest.Mock;

  requireLoanOwner(req as Request, {} as Response, next);
  const error = await done;
  return { next, error };
}

async function runRequireLoanBorrowerAccess(req: Partial<Request>): Promise<{
  next: jest.Mock;
  error: unknown;
}> {
  let settle!: (value: unknown) => void;
  const done = new Promise((resolve) => {
    settle = resolve;
  });

  const next = jest.fn((err?: unknown) => {
    settle(err);
  }) as unknown as NextFunction & jest.Mock;

  requireLoanBorrowerAccess(req as Request, {} as Response, next);
  const error = await done;
  return { next, error };
}

describe('requireLoanOwner (#1365 IDOR & #1860 Unordered query fix)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows the loan owner (stored address matches caller publicKey)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanOwner({
      params: { loanId: 'loan-1' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/loan_events.*address\s+IS\s+NOT\s+NULL.*ORDER\s+BY/i),
      ['loan-1'],
    );
  });

  it('rejects a different caller with 403 — compares loan owner to caller, not caller to itself', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: 'loan-1' },
      user: { publicKey: ATTACKER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);

    expect(OWNER_PK).not.toBe(ATTACKER_PK);
  });

  it('returns 404 when the loan does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: 'missing' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(404);
  });

  it('returns 401 when the caller is unauthenticated', async () => {
    const { error } = await runRequireLoanOwner({
      params: { loanId: 'loan-1' },
      user: undefined,
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when loanId is missing', async () => {
    const { error } = await runRequireLoanOwner({
      params: {},
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('accepts req.params.id as an alternate loan id parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanOwner({
      params: { id: 'loan-alt' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['loan-alt']);
  });

  it('regression (#1860): ignores null-address event rows and matches real borrower LoanApproved row', async () => {
    // Database contains a LateFeeCharged/LoanRejected event with address NULL alongside LoanApproved
    const dbEvents = [
      { event_type: 'LateFeeCharged', address: null },
      { event_type: 'LoanApproved', address: OWNER_PK },
    ];

    mockQuery.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      // The query MUST include `address IS NOT NULL`
      expect(sql).toMatch(/address\s+IS\s+NOT\s+NULL/i);
      expect(sql).toMatch(/ORDER\s+BY/i);

      // Simulate Postgres executing the WHERE address IS NOT NULL filter and ORDER BY
      const nonNullEvents = dbEvents.filter((e) => e.address !== null);
      return { rows: nonNullEvents };
    });

    const { next, error } = await runRequireLoanOwner({
      params: { loanId: 'loan-with-late-fee' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireLoanBorrowerAccess (#1861 & #1860)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when caller publicKey matches stored loan borrower address', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-42' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/contract_events.*address\s+IS\s+NOT\s+NULL.*ORDER\s+BY/i),
      ['loan-42'],
    );
  });

  it('rejects with 403 ACCESS_DENIED when caller publicKey does not match borrower address', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-42' },
      user: { publicKey: ATTACKER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('returns 404 when the loan does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'missing-loan' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(404);
  });

  it('returns 401 when unauthenticated (no publicKey in JWT/req.user)', async () => {
    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-42' },
      user: undefined,
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when loanId param is missing', async () => {
    const { error } = await runRequireLoanBorrowerAccess({
      params: {},
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('bypasses ownership check for admin role without querying the database', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-42' },
      user: { publicKey: ATTACKER_PK, role: 'admin' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('bypasses ownership check for lender role without querying the database', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-42' },
      user: { publicKey: ATTACKER_PK, role: 'lender' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('regression (#1860): ignores null-address event rows and matches real borrower LoanApproved row', async () => {
    // Database contains LateFeeCharged (NULL address) and LoanApproved (OWNER_PK)
    const dbEvents = [
      { event_type: 'LateFeeCharged', address: null },
      { event_type: 'LoanApproved', address: OWNER_PK },
    ];

    mockQuery.mockImplementationOnce(async (sql: string, params: unknown[]) => {
      expect(sql).toMatch(/address\s+IS\s+NOT\s+NULL/i);
      expect(sql).toMatch(/ORDER\s+BY/i);

      const nonNullEvents = dbEvents.filter((e) => e.address !== null);
      return { rows: nonNullEvents };
    });

    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-with-null-events' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
