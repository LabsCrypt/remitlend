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

describe('requireLoanOwner (#1365 IDOR & #1860 deterministic ownership query)', () => {
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
      expect.stringMatching(/loan_events.*address IS NOT NULL.*ORDER BY id ASC/s),
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

  it('regression (#1860): guarantees a non-null borrower address is resolved even when NULL-address rows exist', async () => {
    mockQuery.mockImplementationOnce(async (sql: unknown) => {
      const sqlStr = String(sql);
      expect(sqlStr).toContain('address IS NOT NULL');
      expect(sqlStr).toContain("event_type IN ('LoanRequested', 'LoanApproved')");
      expect(sqlStr).toContain('ORDER BY id ASC');

      return { rows: [{ address: OWNER_PK }] };
    });

    const { next, error } = await runRequireLoanOwner({
      params: { loanId: 'loan-with-late-fees' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireLoanBorrowerAccess (#1860)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when stored address matches caller publicKey', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-1' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/contract_events.*address IS NOT NULL.*ORDER BY id ASC/s),
      ['loan-1'],
    );
  });

  it('bypasses ownership check for admin role', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-1' },
      user: { publicKey: ATTACKER_PK, role: 'admin' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('bypasses ownership check for lender role', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-1' },
      user: { publicKey: ATTACKER_PK, role: 'lender' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects a different caller with 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-1' },
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

  it('regression (#1860): guarantees a non-null borrower address query so legitimate borrower gets next()', async () => {
    mockQuery.mockImplementationOnce(async (sql: unknown) => {
      const sqlStr = String(sql);
      expect(sqlStr).toContain('address IS NOT NULL');
      expect(sqlStr).toContain("event_type IN ('LoanRequested', 'LoanApproved')");
      expect(sqlStr).toContain('ORDER BY id ASC');

      return { rows: [{ address: OWNER_PK }] };
    });

    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'loan-mixed-events' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});
