import {
  buildKeysetClause,
  createCursorPaginatedResponse,
  createPaginatedResponse,
  decodeCursor,
  encodeCursor,
  getSortConfig,
  parseAmountRange,
  parseCursorQueryParams,
  parseDateRange,
  parseKeysetParams,
  parseQueryParams,
} from '../pagination.js';
import type { Request } from 'express';

describe('parseQueryParams amountRange', () => {
  const mockRequest = (amountRange: string | undefined): Partial<Request> => ({
    query: { amount_range: amountRange },
  });

  it('should leave a well-ordered min,max pair unchanged', () => {
    const req = mockRequest('10,100') as Request;
    expect(parseQueryParams(req).amountRange).toEqual({ min: 10, max: 100 });
  });

  it('should swap an out-of-order min,max pair', () => {
    const req = mockRequest('100,10') as Request;
    expect(parseQueryParams(req).amountRange).toEqual({ min: 10, max: 100 });
  });

  it('should return the same value for equal min and max', () => {
    const req = mockRequest('50,50') as Request;
    expect(parseQueryParams(req).amountRange).toEqual({ min: 50, max: 50 });
  });

  it('should return null when amount_range is not provided', () => {
    const req = mockRequest(undefined) as Request;
    expect(parseQueryParams(req).amountRange).toBeNull();
  });
});

describe('parseDateRange', () => {
  it('should leave a well-ordered start,end date range unchanged', () => {
    const result = parseDateRange('2026-01-01,2026-12-31');
    expect(result).not.toBeNull();
    expect(result?.start).toEqual(new Date('2026-01-01'));
    expect(result?.end).toEqual(new Date('2026-12-31'));
  });

  it('should swap start and end when given a reversed date range', () => {
    const result = parseDateRange('2026-12-31,2026-01-01');
    expect(result).not.toBeNull();
    expect(result?.start).toEqual(new Date('2026-01-01'));
    expect(result?.end).toEqual(new Date('2026-12-31'));
  });

  it('should return the same date for equal start and end', () => {
    const result = parseDateRange('2026-06-15T00:00:00.000Z,2026-06-15T00:00:00.000Z');
    expect(result).not.toBeNull();
    expect(result?.start).toEqual(new Date('2026-06-15T00:00:00.000Z'));
    expect(result?.end).toEqual(new Date('2026-06-15T00:00:00.000Z'));
  });

  it('should trim surrounding whitespace from date components', () => {
    const result = parseDateRange('  2026-03-01  ,  2026-04-01  ');
    expect(result).not.toBeNull();
    expect(result?.start).toEqual(new Date('2026-03-01'));
    expect(result?.end).toEqual(new Date('2026-04-01'));
  });

  it('should reject and handle invalid date strings without throwing an unhandled error', () => {
    expect(() => parseDateRange('invalid-start,2026-12-31')).not.toThrow();
    expect(parseDateRange('invalid-start,2026-12-31')).toBeNull();

    expect(() => parseDateRange('2026-01-01,invalid-end')).not.toThrow();
    expect(parseDateRange('2026-01-01,invalid-end')).toBeNull();

    expect(() => parseDateRange('nonsense,garbage')).not.toThrow();
    expect(parseDateRange('nonsense,garbage')).toBeNull();
  });

  it('should return null when date string has missing start or end segments', () => {
    expect(parseDateRange('2026-01-01')).toBeNull();
    expect(parseDateRange(',2026-12-31')).toBeNull();
    expect(parseDateRange('2026-01-01,')).toBeNull();
    expect(parseDateRange(' , ')).toBeNull();
    expect(parseDateRange('')).toBeNull();
  });

  it('should return null when input is not a string', () => {
    expect(parseDateRange(undefined)).toBeNull();
    expect(parseDateRange(null)).toBeNull();
    expect(parseDateRange(12345)).toBeNull();
    expect(parseDateRange({})).toBeNull();
    expect(parseDateRange(['2026-01-01', '2026-12-31'])).toBeNull();
  });
});

describe('parseQueryParams dateRange integration', () => {
  it('should parse valid date_range from request query', () => {
    const req = {
      query: { date_range: '2026-02-01,2026-05-01' },
    } as unknown as Request;
    const params = parseQueryParams(req);
    expect(params.dateRange).toEqual({
      start: new Date('2026-02-01'),
      end: new Date('2026-05-01'),
    });
  });

  it('should swap reversed date_range from request query', () => {
    const req = {
      query: { date_range: '2026-05-01,2026-02-01' },
    } as unknown as Request;
    const params = parseQueryParams(req);
    expect(params.dateRange).toEqual({
      start: new Date('2026-02-01'),
      end: new Date('2026-05-01'),
    });
  });

  it('should handle invalid date_range in request query gracefully returning null', () => {
    const req = {
      query: { date_range: 'invalid,date' },
    } as unknown as Request;
    expect(() => parseQueryParams(req)).not.toThrow();
    expect(parseQueryParams(req).dateRange).toBeNull();
  });

  it('should return null when date_range is omitted', () => {
    const req = { query: {} } as unknown as Request;
    expect(parseQueryParams(req).dateRange).toBeNull();
  });
});

describe('parseCursorQueryParams', () => {
  it('clamps an out-of-range limit to MAX_LIMIT (100)', () => {
    const reqOver = { query: { limit: '500' } } as unknown as Request;
    expect(parseCursorQueryParams(reqOver).limit).toBe(100);

    const reqBound = { query: { limit: '101' } } as unknown as Request;
    expect(parseCursorQueryParams(reqBound).limit).toBe(100);
  });

  it('falls back to DEFAULT_LIMIT (50) for negative, non-numeric, or missing limit', () => {
    const reqNegative = { query: { limit: '-10' } } as unknown as Request;
    expect(parseCursorQueryParams(reqNegative).limit).toBe(50);

    const reqNonsense = { query: { limit: 'not-a-number' } } as unknown as Request;
    expect(parseCursorQueryParams(reqNonsense).limit).toBe(50);

    const reqEmpty = { query: {} } as unknown as Request;
    expect(parseCursorQueryParams(reqEmpty).limit).toBe(50);
  });

  it('preserves valid limits within bounds', () => {
    const reqValid = { query: { limit: '25' } } as unknown as Request;
    expect(parseCursorQueryParams(reqValid).limit).toBe(25);

    const reqMax = { query: { limit: '100' } } as unknown as Request;
    expect(parseCursorQueryParams(reqMax).limit).toBe(100);
  });

  it('rejects a malformed or empty cursor value by returning null', () => {
    // Blank whitespace cursor
    const reqWhitespace = { query: { cursor: '   ' } } as unknown as Request;
    expect(parseCursorQueryParams(reqWhitespace).cursor).toBeNull();

    // Empty string cursor
    const reqEmptyString = { query: { cursor: '' } } as unknown as Request;
    expect(parseCursorQueryParams(reqEmptyString).cursor).toBeNull();

    // Non-string array cursor
    const reqArray = {
      query: { cursor: ['cursor_a', 'cursor_b'] as unknown as string },
    } as Request;
    expect(parseCursorQueryParams(reqArray).cursor).toBeNull();

    // Non-string object cursor
    const reqObject = { query: { cursor: { token: 'abc' } as unknown as string } } as Request;
    expect(parseCursorQueryParams(reqObject).cursor).toBeNull();

    // Missing cursor
    const reqMissing = { query: {} } as unknown as Request;
    expect(parseCursorQueryParams(reqMissing).cursor).toBeNull();
  });

  it('accepts a valid non-empty cursor string and trims surrounding whitespace', () => {
    const req = { query: { cursor: '  cursor_seq_100  ' } } as unknown as Request;
    expect(parseCursorQueryParams(req).cursor).toBe('cursor_seq_100');
  });

  it('correctly parses and swaps reversed date_range', () => {
    const req = {
      query: { date_range: '2026-10-31,2026-01-01' },
    } as unknown as Request;
    const params = parseCursorQueryParams(req);
    expect(params.dateRange).toEqual({
      start: new Date('2026-01-01'),
      end: new Date('2026-10-31'),
    });
  });

  it('handles invalid date_range returning null without throwing', () => {
    const req = {
      query: { date_range: 'invalid,bad' },
    } as unknown as Request;
    expect(() => parseCursorQueryParams(req)).not.toThrow();
    expect(parseCursorQueryParams(req).dateRange).toBeNull();
  });

  it('correctly parses and swaps reversed amount_range', () => {
    const req = {
      query: { amount_range: '1000,50' },
    } as unknown as Request;
    expect(parseCursorQueryParams(req).amountRange).toEqual({
      min: 50,
      max: 1000,
    });
  });

  it('parses sort and status while ignoring whitespace-only strings', () => {
    const req = {
      query: { sort: 'loan_id', status: 'active' },
    } as unknown as Request;
    const params = parseCursorQueryParams(req);
    expect(params.sort).toBe('loan_id');
    expect(params.status).toBe('active');

    const reqBlank = {
      query: { sort: '   ', status: '   ' },
    } as unknown as Request;
    const blankParams = parseCursorQueryParams(reqBlank);
    expect(blankParams.sort).toBeNull();
    expect(blankParams.status).toBeNull();
  });
});

describe('parseAmountRange', () => {
  it('should return null for non-finite or malformed amount inputs', () => {
    expect(parseAmountRange('abc,100')).toBeNull();
    expect(parseAmountRange('10,def')).toBeNull();
    expect(parseAmountRange('single_value')).toBeNull();
    expect(parseAmountRange(' , ')).toBeNull();
    expect(parseAmountRange('')).toBeNull();
    expect(parseAmountRange(null)).toBeNull();
    expect(parseAmountRange(undefined)).toBeNull();
  });
});

describe('getSortConfig and paginated response helpers', () => {
  const allowed = ['createdAt', 'amount', 'status'];

  it('returns default field and direction when sort is not provided', () => {
    const config = getSortConfig(null, allowed, 'createdAt', 'DESC');
    expect(config).toEqual({ field: 'createdAt', direction: 'DESC' });
  });

  it('returns ASC sort config for an allowed field', () => {
    const config = getSortConfig('amount', allowed, 'createdAt', 'DESC');
    expect(config).toEqual({ field: 'amount', direction: 'ASC' });
  });

  it('returns DESC sort config and strips leading hyphen for descending sort', () => {
    const config = getSortConfig('-status', allowed, 'createdAt', 'ASC');
    expect(config).toEqual({ field: 'status', direction: 'DESC' });
  });

  it('falls back to default sort when requested field is not in allowed list', () => {
    const config = getSortConfig('unauthorized_field', allowed, 'createdAt', 'DESC');
    expect(config).toEqual({ field: 'createdAt', direction: 'DESC' });
  });

  it('creates paginated response envelope with correct page info', () => {
    const res = createPaginatedResponse(['item1', 'item2'], 10, 2, 0, 2);
    expect(res).toEqual({
      success: true,
      data: ['item1', 'item2'],
      total_count: 10,
      page_info: {
        limit: 2,
        offset: 0,
        count: 2,
        has_previous: false,
        has_next: true,
      },
    });
  });

  it('creates cursor paginated response envelope with correct page info', () => {
    const res = createCursorPaginatedResponse(['row1'], 100, 10, 1, 'cursor_next', true);
    expect(res).toEqual({
      success: true,
      data: ['row1'],
      total_count: 100,
      page_info: {
        limit: 10,
        count: 1,
        next_cursor: 'cursor_next',
        has_previous: true,
        has_next: true,
      },
    });
  });
});

describe('keyset cursor encoding', () => {
  it('round-trips a cursor through encode and decode', () => {
    const createdAt = new Date('2026-04-01T12:00:00.000Z');
    const decoded = decodeCursor(encodeCursor(createdAt, 42n));

    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.seq).toBe(42n);
  });

  it('produces an opaque cursor with no base64 padding or url-unsafe chars', () => {
    // Clients must not be able to parse or tamper with the cursor, and it has
    // to survive being placed in a query string unencoded.
    const cursor = encodeCursor(new Date('2026-04-01T12:00:00.000Z'), 42n);
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('rejects a malformed cursor with INVALID_CURSOR', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
  });

  it('rejects a cursor missing its seq', () => {
    const bad = Buffer.from(JSON.stringify({ createdAt: '2026-04-01T12:00:00.000Z' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(() => decodeCursor(bad)).toThrow();
  });
});

describe('buildKeysetClause', () => {
  it('constrains to the snapshot when there is no cursor', () => {
    const { whereClause, params } = buildKeysetClause(null, 100n);

    // The snapshot bound is what keeps a page stable under concurrent writes.
    expect(whereClause).toBe('seq <= $1');
    expect(params).toEqual([100n]);
  });

  it('adds a seek predicate once a cursor is supplied', () => {
    const cursor = { createdAt: new Date('2026-04-01T12:00:00.000Z'), seq: 42n };
    const { whereClause, params } = buildKeysetClause(cursor, 100n);

    expect(whereClause).toContain('created_at < $2');
    expect(whereClause).toContain('created_at = $3');
    expect(whereClause).toContain('seq < $4');
    expect(params).toHaveLength(4);
  });

  it('applies a table alias to every column', () => {
    // A missing prefix produces an ambiguous-column error only at runtime,
    // against a real join.
    const { whereClause } = buildKeysetClause(null, 100n, 't');
    expect(whereClause).toBe('t.seq <= $1');
  });
});

describe('parseKeysetParams', () => {
  it('falls back to defaults when nothing is supplied', () => {
    const params = parseKeysetParams(null, null, null);
    expect(params).toEqual({ snapshotSeq: 0n, cursor: null, limit: 50 });
  });

  it('caps the limit at the maximum', () => {
    expect(parseKeysetParams(null, null, 5000).limit).toBe(100);
  });

  it('falls back to the default limit for a nonsense value', () => {
    expect(parseKeysetParams(null, null, 'abc').limit).toBe(50);
    expect(parseKeysetParams(null, null, -1).limit).toBe(50);
  });

  it('treats a blank cursor as absent', () => {
    expect(parseKeysetParams(null, '   ', null).cursor).toBeNull();
  });

  it('rejects an unparseable snapshot_seq', () => {
    expect(() => parseKeysetParams('not-a-number', null, null)).toThrow();
  });
});
