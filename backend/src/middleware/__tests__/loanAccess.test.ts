import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const mockQuery = jest.fn();

jest.unstable_mockModule('../../db/connection.js', () => ({
  withAdvisoryLock: async (_key: string, fn: () => Promise<unknown>) => fn(),
  query: mockQuery,
}));

const { requireLoanOwner, requireLoanBorrowerAccess } = await import('../loanAccess.js');
const { AppError } = await import('../../errors/AppError.js');
const { ErrorCode } = await import('../../errors/errorCodes.js');

const OWNER_PK = 'GOWNERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ATTACKER_PK = 'GATTACKERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const ADMIN_PK = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const LENDER_PK = 'GLENDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const UNRELATED_PK = 'GUNRELATEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

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
      params: { loanId: '1' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/loan_events.*address IS NOT NULL.*ORDER BY id ASC/s),
      ['1'],
    );
  });

  it('rejects a different caller with 403 — compares loan owner to caller, not caller to itself', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: '1' },
      user: { publicKey: ATTACKER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);

    expect(OWNER_PK).not.toBe(ATTACKER_PK);
  });

  it('strictly enforces ownership against admin role (no admin bypass on owner-only actions)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: '10' },
      user: { publicKey: ADMIN_PK, role: 'admin' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('strictly enforces ownership against lender role (no lender bypass on owner-only actions)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: '10' },
      user: { publicKey: LENDER_PK, role: 'lender' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('rejects an unrelated user attempting to claim ownership of another user loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: '10' },
      user: { publicKey: UNRELATED_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('returns 404 when the loan does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { error } = await runRequireLoanOwner({
      params: { loanId: '999' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(404);
  });

  it('returns 401 when the caller is unauthenticated', async () => {
    const { error } = await runRequireLoanOwner({
      params: { loanId: '1' },
      user: undefined,
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when loanId param is missing', async () => {
    const { error } = await runRequireLoanOwner({
      params: {},
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect((error as InstanceType<typeof AppError>).message).toContain('Loan ID is required');
  });

  it('accepts req.params.id as an alternate loan id parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanOwner({
      params: { id: '5' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['5']);
  });

  it('prefers req.params.loanId over req.params.id when both are present', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanOwner({
      params: { loanId: '7', id: '999' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(expect.any(String), ['7']);
  });

  it('propagates database query rejections to next', async () => {
    const dbError = new Error('database connection lost');
    mockQuery.mockRejectedValueOnce(dbError);

    const { error } = await runRequireLoanOwner({
      params: { loanId: '1' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBe(dbError);
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
      params: { loanId: '3' },
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('requireLoanBorrowerAccess tenant boundaries and authorization (#1860)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when stored address matches caller publicKey', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringMatching(/contract_events.*address IS NOT NULL.*ORDER BY id ASC/s),
      ['1'],
    );
  });

  it('bypasses ownership check for admin role', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: ATTACKER_PK, role: 'admin' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('bypasses ownership check for lender role', async () => {
    const { next, error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: ATTACKER_PK, role: 'lender' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('rejects an unrelated borrower trying to access another borrower loan with 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: UNRELATED_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('rejects a caller with an undefined or unrecognized role who does not own the loan', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: UNRELATED_PK, role: undefined },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(403);
    expect(appError.errorCode).toBe(ErrorCode.ACCESS_DENIED);
  });

  it('rejects role casing variations (e.g. Admin or LENDER) from bypassing ownership check', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: UNRELATED_PK, role: 'Admin' },
    } as Partial<Request>);

    // Since 'Admin' !== 'admin', ownership check is executed and rejects unrelated user
    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(403);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('requires authentication even for callers specifying admin role', async () => {
    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: undefined,
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('requires valid loanId parameter even for admin or lender roles', async () => {
    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: 'invalid-id' },
      user: { publicKey: ADMIN_PK, role: 'admin' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect((error as InstanceType<typeof AppError>).errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when loanId param is missing', async () => {
    const { error } = await runRequireLoanBorrowerAccess({
      params: {},
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect((error as InstanceType<typeof AppError>).message).toContain('Loan ID is required');
  });

  it('returns 404 when the loan does not exist in contract_events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '999' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeInstanceOf(AppError);
    expect((error as InstanceType<typeof AppError>).statusCode).toBe(404);
  });

  it('propagates database query rejections to next', async () => {
    const dbError = new Error('db failure');
    mockQuery.mockRejectedValueOnce(dbError);

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBe(dbError);
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
      params: { loanId: '4' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('loanId validation (numeric format and boundary handling)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const req = (params: Record<string, string>) =>
    ({ params, user: { publicKey: OWNER_PK, role: 'borrower' } }) as unknown as Partial<Request>;

  it.each(['abc', '1abc', '1; DROP TABLE x', '-1', '1.5', '0x10'])(
    'requireLoanOwner rejects invalid loanId "%s" with INVALID_LOAN_ID',
    async (id) => {
      const { error } = await runRequireLoanOwner(req({ loanId: id }));
      expect(error).toBeInstanceOf(AppError);
      const appError = error as InstanceType<typeof AppError>;
      expect(appError.statusCode).toBe(400);
      expect(appError.errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
      expect(mockQuery).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '1', '12345', '9007199254740991'])(
    'accepts valid numeric boundary loanId "%s"',
    async (id) => {
      mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });
      const { next, error } = await runRequireLoanOwner(req({ loanId: id }));
      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [id]);
    },
  );

  it('requireLoanBorrowerAccess rejects a non-numeric loanId with INVALID_LOAN_ID', async () => {
    const { error } = await runRequireLoanBorrowerAccess(req({ loanId: 'abc' }));
    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(400);
    expect(appError.errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
