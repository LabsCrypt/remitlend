import {
  buildKeysetClause,
  decodeCursor,
  encodeCursor,
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
