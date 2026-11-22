import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';

import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import {
  buildKeysetClause,
  createCursorPaginatedResponse,
  createPaginatedResponse,
  decodeCursor,
  encodeCursor,
  getSortConfig,
  parseCursorQueryParams,
  parseKeysetParams,
  parseQueryParams,
} from '../pagination.js';

const CREATED_AT = '2026-11-10T08:30:00.000Z';

const encodePayload = (payload: unknown): string =>
  btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

const expectInvalidRequest = (run: () => unknown, message: RegExp): AppError => {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AppError);
  const appError = caught as AppError;
  expect(appError.statusCode).toBe(400);
  expect(appError.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
  expect(appError.isOperational).toBe(true);
  expect(appError.message).toMatch(message);
  return appError;
};

const requestWith = (query: Record<string, unknown>): Request => ({ query }) as Request;

describe('pagination cursor tampering (#2086)', () => {
  it('round-trips a seq beyond Number.MAX_SAFE_INTEGER without losing precision', () => {
    const seq = 9_007_199_254_740_993n;
    const decoded = decodeCursor(encodeCursor(new Date(CREATED_AT), seq));

    expect(decoded.seq).toBe(seq);
    expect(decoded.createdAt.toISOString()).toBe(CREATED_AT);
  });

  it('decodes an oversized numeric seq as an exact bigint', () => {
    const seq = '123456789012345678901234567890';
    const decoded = decodeCursor(encodePayload({ createdAt: CREATED_AT, seq }));

    expect(decoded.seq).toBe(BigInt(seq));
  });

  it('rejects a cursor whose seq was edited to a non-numeric value', () => {
    const error = expectInvalidRequest(
      () => decodeCursor(encodePayload({ createdAt: CREATED_AT, seq: 'not-a-number' })),
      /^Invalid cursor:/,
    );

    expect(error.status).toBe('fail');
  });

  it('rejects cursors with invalid or wrong-typed fields', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{}, /Missing or invalid createdAt/],
      [{ createdAt: 42, seq: '1' }, /Missing or invalid createdAt/],
      [{ createdAt: 'yesterday', seq: '1' }, /Invalid createdAt date/],
      [{ createdAt: CREATED_AT, seq: 42 }, /Missing or invalid seq/],
      [{ createdAt: CREATED_AT, seq: '' }, /Missing or invalid seq/],
      [{ createdAt: CREATED_AT, seq: '1.5' }, /^Invalid cursor:/],
    ];

    for (const [payload, message] of cases) {
      expectInvalidRequest(() => decodeCursor(encodePayload(payload)), message);
    }
  });

  it('rejects payloads that are base64url but not JSON, and truncated cursors', () => {
    expectInvalidRequest(() => decodeCursor(encodePayload('not-an-object')), /^Invalid cursor:/);
    expectInvalidRequest(() => decodeCursor('!!!'), /^Invalid cursor:/);

    const cursor = encodeCursor(new Date(CREATED_AT), 42n);
    expectInvalidRequest(() => decodeCursor(cursor.slice(0, -8)), /^Invalid cursor:/);
  });

  it('keeps an oversized snapshot_seq as a bigint but rejects fractional values', () => {
    const snapshotSeq = '987654321098765432109876543210';
    expect(parseKeysetParams(snapshotSeq, null, null).snapshotSeq).toBe(BigInt(snapshotSeq));

    expectInvalidRequest(() => parseKeysetParams('12.5', null, null), /Invalid snapshot_seq/);
    expectInvalidRequest(() => parseKeysetParams('NaN', null, null), /Invalid snapshot_seq/);
  });

  it('accepts signed and zero snapshot boundaries without coercion', () => {
    expect(parseKeysetParams('-1', null, null).snapshotSeq).toBe(-1n);
    expect(parseKeysetParams(0, null, null).snapshotSeq).toBe(0n);
    expect(parseKeysetParams('', null, null).snapshotSeq).toBe(0n);
  });

  it('uses the tampered cursor value only as a parameter, never interpolated SQL', () => {
    const seq = 9_007_199_254_740_993n;
    const cursor = decodeCursor(encodeCursor(new Date(CREATED_AT), seq));
    const { whereClause, params } = buildKeysetClause(cursor, 100n, 't');

    expect(whereClause).toBe(
      't.seq <= $1 AND (t.created_at < $2 OR (t.created_at = $3 AND t.seq < $4))',
    );
    expect(params).toEqual([100n, CREATED_AT, CREATED_AT, seq]);
    expect(whereClause).not.toContain(String(seq));
  });
});

describe('pagination sort and query boundaries (#2086)', () => {
  const allowedFields = ['created_at', 'amount'] as const;

  it.each([
    [null, 'created_at', 'DESC'],
    ['amount', 'amount', 'ASC'],
    ['-amount', 'amount', 'DESC'],
    ['created_at', 'created_at', 'ASC'],
    ['-created_at', 'created_at', 'DESC'],
    ['unknown', 'created_at', 'DESC'],
    ['-unknown', 'created_at', 'DESC'],
    ['-', 'created_at', 'DESC'],
  ])('maps sort=%s to { field: %s, direction: %s }', (sort, field, direction) => {
    expect(getSortConfig(sort, allowedFields, 'created_at', 'DESC')).toEqual({
      field,
      direction,
    });
  });

  it('normalizes limit and offset boundaries in offset pagination', () => {
    expect(parseQueryParams(requestWith({ limit: '5000', offset: '-4' }))).toMatchObject({
      limit: 100,
      offset: 0,
    });
    expect(parseQueryParams(requestWith({ limit: '0', offset: '2' }))).toMatchObject({
      limit: 0,
      offset: 2,
    });
    expect(parseQueryParams(requestWith({ limit: Number.NaN, offset: 1.9 }))).toMatchObject({
      limit: 50,
      offset: 1,
    });
  });

  it('caps the keyset limit at the maximum and falls back for zero or negative limits', () => {
    expect(parseKeysetParams(null, null, '100').limit).toBe(100);
    expect(parseKeysetParams(null, null, '101').limit).toBe(100);
    expect(parseKeysetParams(null, null, '0').limit).toBe(50);
    expect(parseKeysetParams(null, null, -1).limit).toBe(50);
  });

  it('parses mixed cursor query parameters deterministically', () => {
    const params = parseCursorQueryParams(
      requestWith({
        limit: '5000',
        cursor: '  a-cursor  ',
        sort: ' -created_at ',
        status: '   ',
        date_range: '2026-11-10,2026-11-01',
        amount_range: '900,100',
      }),
    );

    expect(params).toEqual({
      limit: 100,
      cursor: 'a-cursor',
      sort: '-created_at',
      status: null,
      dateRange: {
        start: new Date('2026-11-01T00:00:00.000Z'),
        end: new Date('2026-11-10T00:00:00.000Z'),
      },
      amountRange: { min: 100, max: 900 },
    });
  });

  it('discards malformed date and amount ranges instead of throwing', () => {
    const params = parseCursorQueryParams(
      requestWith({ date_range: 'nope,2026-11-01', amount_range: '1,nope' }),
    );

    expect(params.dateRange).toBeNull();
    expect(params.amountRange).toBeNull();
  });
});

describe('pagination response envelope boundaries (#2086)', () => {
  it('reports no neighbours for a single empty page', () => {
    const response = createPaginatedResponse([], 0, 50, 0, 0);

    expect(response.success).toBe(true);
    expect(response.page_info).toEqual({
      limit: 50,
      offset: 0,
      count: 0,
      has_previous: false,
      has_next: false,
    });
  });

  it('reports both neighbours for a full page in the middle', () => {
    const response = createPaginatedResponse([1, 2], 10, 2, 4, 2);
    expect(response.page_info.has_previous).toBe(true);
    expect(response.page_info.has_next).toBe(true);
  });

  it('does not report a next page when the last row was consumed', () => {
    const response = createPaginatedResponse([1], 100, 10, 90, 10);
    expect(response.page_info.has_next).toBe(false);
  });

  it('derives has_next from the cursor rather than the count', () => {
    const withoutCursor = createCursorPaginatedResponse([], null, 25, 0, null, true);
    const withCursor = createCursorPaginatedResponse(['row'], 40, 25, 25, 'next', true);

    expect(withoutCursor).toMatchObject({
      success: true,
      total_count: null,
      page_info: {
        limit: 25,
        count: 0,
        next_cursor: null,
        has_previous: true,
        has_next: false,
      },
    });
    expect(withCursor.page_info).toMatchObject({
      next_cursor: 'next',
      has_next: true,
    });
    expect(withCursor.total_count).toBe(40);
  });
});
