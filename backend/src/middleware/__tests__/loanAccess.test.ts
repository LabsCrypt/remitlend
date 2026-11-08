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

describe('requireLoanBorrowerAccess (#1860)', () => {
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

  it('rejects a different caller with 403', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ address: OWNER_PK }] });

    const { error } = await runRequireLoanBorrowerAccess({
      params: { loanId: '1' },
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
      params: { loanId: '999' },
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
      params: { loanId: '4' },
      user: { publicKey: OWNER_PK, role: 'borrower' },
    } as Partial<Request>);

    expect(error).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
  });
});

describe('loanId validation (non-integer ids return 400 before any DB query)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const req = (params: Record<string, string>) =>
    ({ params, user: { publicKey: OWNER_PK, role: 'borrower' } }) as unknown as Partial<Request>;

  it.each(['abc', '1abc', '1; DROP TABLE x', '-1', '1.5'])(
    'requireLoanOwner rejects %s with INVALID_LOAN_ID',
    async (id) => {
      const { error } = await runRequireLoanOwner(req({ loanId: id }));
      expect(error).toBeInstanceOf(AppError);
      const appError = error as InstanceType<typeof AppError>;
      expect(appError.statusCode).toBe(400);
      expect(appError.errorCode).toBe(ErrorCode.INVALID_LOAN_ID);
      expect(mockQuery).not.toHaveBeenCalled();
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

  it('rejects missing loanId parameter with 400 Bad Request', async () => {
    const { error: ownerError } = await runRequireLoanOwner({
      params: {},
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);
    expect(ownerError).toBeInstanceOf(AppError);
    expect((ownerError as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect((ownerError as InstanceType<typeof AppError>).message).toBe('Loan ID is required');

    const { error: borrowerError } = await runRequireLoanBorrowerAccess({
      params: {},
      user: { publicKey: OWNER_PK },
    } as Partial<Request>);
    expect(borrowerError).toBeInstanceOf(AppError);
    expect((borrowerError as InstanceType<typeof AppError>).statusCode).toBe(400);
    expect((borrowerError as InstanceType<typeof AppError>).message).toBe('Loan ID is required');
  });
});

describe('tenant boundary isolation & multi-role access matrix (#2092)', () => {
  const BORROWER_ALICE = 'GALICEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const BORROWER_BOB = 'GBOBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const UNRELATED_USER = 'GUNRELATEDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ADMIN_USER = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const LENDER_USER = 'GLENDERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('multi-tenant cross-account isolation between borrowers', () => {
    it('prevents Alice from accessing Bob loan via requireLoanBorrowerAccess', async () => {
      // Bob owns loan 200
      mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_BOB }] });

      const { next, error } = await runRequireLoanBorrowerAccess({
        params: { loanId: '200' },
        user: { publicKey: BORROWER_ALICE, role: 'borrower' },
      } as Partial<Request>);

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as InstanceType<typeof AppError>;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
      expect(next).toHaveBeenCalledWith(appErr);
    });

    it('prevents Bob from accessing Alice loan via requireLoanBorrowerAccess', async () => {
      // Alice owns loan 100
      mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_ALICE }] });

      const { next, error } = await runRequireLoanBorrowerAccess({
        params: { loanId: '100' },
        user: { publicKey: BORROWER_BOB, role: 'borrower' },
      } as Partial<Request>);

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as InstanceType<typeof AppError>;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
      expect(next).toHaveBeenCalledWith(appErr);
    });

    it('prevents Alice from accessing Bob loan via requireLoanOwner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_BOB }] });

      const { next, error } = await runRequireLoanOwner({
        params: { loanId: '200' },
        user: { publicKey: BORROWER_ALICE },
      } as Partial<Request>);

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as InstanceType<typeof AppError>;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
      expect(next).toHaveBeenCalledWith(appErr);
    });
  });

  describe('unrelated user access rejection', () => {
    it.each(['borrower', 'investor', 'guest', 'auditor', undefined])(
      'rejects unrelated caller with role "%s" with 403 ACCESS_DENIED',
      async (role) => {
        mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_ALICE }] });

        const { next, error } = await runRequireLoanBorrowerAccess({
          params: { loanId: '100' },
          user: { publicKey: UNRELATED_USER, role },
        } as Partial<Request>);

        expect(error).toBeInstanceOf(AppError);
        const appErr = error as InstanceType<typeof AppError>;
        expect(appErr.statusCode).toBe(403);
        expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
        expect(next).toHaveBeenCalledWith(appErr);
      },
    );
  });

  describe('privileged roles (admin & lender) in requireLoanBorrowerAccess', () => {
    it('allows admin access without database query', async () => {
      const { next, error } = await runRequireLoanBorrowerAccess({
        params: { loanId: '100' },
        user: { publicKey: ADMIN_USER, role: 'admin' },
      } as Partial<Request>);

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('allows lender access without database query', async () => {
      const { next, error } = await runRequireLoanBorrowerAccess({
        params: { loanId: '100' },
        user: { publicKey: LENDER_USER, role: 'lender' },
      } as Partial<Request>);

      expect(error).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('strict borrower ownership in requireLoanOwner (no role bypass)', () => {
    it('rejects admin caller if admin is not the recorded loan owner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_ALICE }] });

      const { next, error } = await runRequireLoanOwner({
        params: { loanId: '100' },
        user: { publicKey: ADMIN_USER, role: 'admin' },
      } as Partial<Request>);

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as InstanceType<typeof AppError>;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
      expect(next).toHaveBeenCalledWith(appErr);
    });

    it('rejects lender caller if lender is not the recorded loan owner', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ address: BORROWER_ALICE }] });

      const { next, error } = await runRequireLoanOwner({
        params: { loanId: '100' },
        user: { publicKey: LENDER_USER, role: 'lender' },
      } as Partial<Request>);

      expect(error).toBeInstanceOf(AppError);
      const appErr = error as InstanceType<typeof AppError>;
      expect(appErr.statusCode).toBe(403);
      expect(appErr.errorCode).toBe(ErrorCode.ACCESS_DENIED);
      expect(next).toHaveBeenCalledWith(appErr);
    });
  });
});
