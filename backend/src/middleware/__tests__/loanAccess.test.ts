import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

const { requireLoanOwner } = await import('../loanAccess.js');
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

describe('requireLoanOwner (#1365 IDOR)', () => {
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
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('loan_events'), ['loan-1']);
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

    // Previous IDOR was `if (pk !== pk)` which never forbids any caller.
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
});
