import {
  buildKeysetClause,
  decodeCursor,
  encodeCursor,
  parseCursorQueryParams,
  parseKeysetParams,
  parseQueryParams,
} from '../pagination.js';
import type { Request } from 'express';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';

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

describe('mixed sort directions in query parsing', () => {
  const mockSortRequest = (sortValue: unknown): Partial<Request> => ({
    query: { sort: sortValue as string },
  });

  it('parses standard ascending and descending sort directions', () => {
    const reqAsc = mockSortRequest('asc') as Request;
    expect(parseQueryParams(reqAsc).sort).toBe('asc');

    const reqDesc = mockSortRequest('desc') as Request;
    expect(parseQueryParams(reqDesc).sort).toBe('desc');
  });

  it('parses column:direction compound sort strings', () => {
    const reqCreatedAt = mockSortRequest('created_at:desc') as Request;
    expect(parseQueryParams(reqCreatedAt).sort).toBe('created_at:desc');

    const reqAmountAsc = mockSortRequest('amount:asc') as Request;
    expect(parseQueryParams(reqAmountAsc).sort).toBe('amount:asc');
  });

  it('parses mixed sort directions in parseCursorQueryParams', () => {
    const req = {
      query: {
        sort: 'seq:desc',
        limit: '25',
        cursor: 'some_cursor_token',
      },
    } as unknown as Request;

    const parsed = parseCursorQueryParams(req);
    expect(parsed.sort).toBe('seq:desc');
    expect(parsed.limit).toBe(25);
    expect(parsed.cursor).toBe('some_cursor_token');
  });

  it('treats whitespace or empty sort parameters as null', () => {
    expect(parseQueryParams(mockSortRequest('') as Request).sort).toBeNull();
    expect(parseQueryParams(mockSortRequest('   ') as Request).sort).toBeNull();
    expect(parseCursorQueryParams(mockSortRequest('   ') as Request).sort).toBeNull();
  });
});

describe('keyset cursor encoding and tampering defense', () => {
  const toBase64url = (str: string): string =>
    Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  it('round-trips a cursor through encode and decode', () => {
    const createdAt = new Date('2026-04-01T12:00:00.000Z');
    const decoded = decodeCursor(encodeCursor(createdAt, 42n));

    expect(decoded.createdAt.toISOString()).toBe(createdAt.toISOString());
    expect(decoded.seq).toBe(42n);
  });

  it('produces an opaque cursor with no base64 padding or url-unsafe chars', () => {
    const cursor = encodeCursor(new Date('2026-04-01T12:00:00.000Z'), 42n);
    expect(cursor).not.toMatch(/[+/=]/);
  });

  it('handles huge 64-bit integer overflows and boundary sequences', () => {
    const createdAt = new Date('2026-04-01T12:00:00.000Z');
    const max64Bit = 9223372036854775807n; // max signed 64-bit int
    const cursorMax = encodeCursor(createdAt, max64Bit);
    const decodedMax = decodeCursor(cursorMax);
    expect(decodedMax.seq).toBe(max64Bit);

    const hugeUnsigned = 18446744073709551615n; // max unsigned 64-bit int
    const cursorHuge = encodeCursor(createdAt, hugeUnsigned);
    const decodedHuge = decodeCursor(cursorHuge);
    expect(decodedHuge.seq).toBe(hugeUnsigned);

    const zeroSeq = 0n;
    const decodedZero = decodeCursor(encodeCursor(createdAt, zeroSeq));
    expect(decodedZero.seq).toBe(zeroSeq);
  });

  describe('cursor tampering rejection', () => {
    it('rejects a malformed non-base64 cursor string', () => {
      expect(() => decodeCursor('not-a-cursor!@#$%^')).toThrow(AppError);
    });

    it('rejects a cursor that decodes to non-JSON string', () => {
      const plainTextCursor = toBase64url('random plain text string');
      expect(() => decodeCursor(plainTextCursor)).toThrow(AppError);
    });

    it('rejects a cursor missing its seq field', () => {
      const bad = toBase64url(JSON.stringify({ createdAt: '2026-04-01T12:00:00.000Z' }));
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('rejects a cursor with non-string seq', () => {
      const bad = toBase64url(
        JSON.stringify({ createdAt: '2026-04-01T12:00:00.000Z', seq: 12345 }),
      );
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('rejects a cursor with unparseable BigInt in seq', () => {
      const bad = toBase64url(
        JSON.stringify({ createdAt: '2026-04-01T12:00:00.000Z', seq: 'not_a_valid_bigint' }),
      );
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('rejects a cursor missing its createdAt field', () => {
      const bad = toBase64url(JSON.stringify({ seq: '42' }));
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('rejects a cursor with non-string createdAt', () => {
      const bad = toBase64url(JSON.stringify({ createdAt: 123456789, seq: '42' }));
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('rejects a cursor with invalid date format in createdAt', () => {
      const bad = toBase64url(JSON.stringify({ createdAt: 'invalid-iso-date-string', seq: '42' }));
      expect(() => decodeCursor(bad)).toThrow(AppError);
    });

    it('asserts AppError status 400 and VALIDATION_ERROR code on tampering', () => {
      let error: unknown;
      try {
        decodeCursor('tampered_cursor_data');
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });
});

describe('buildKeysetClause', () => {
  it('constrains to the snapshot when there is no cursor', () => {
    const { whereClause, params } = buildKeysetClause(null, 100n);

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
    const { whereClause } = buildKeysetClause(null, 100n, 't');
    expect(whereClause).toBe('t.seq <= $1');
  });

  it('handles boundary sequences and timestamps in buildKeysetClause', () => {
    const epochDate = new Date('1970-01-01T00:00:00.000Z');
    const maxSeq = 18446744073709551615n;
    const { whereClause, params } = buildKeysetClause({ createdAt: epochDate, seq: 0n }, maxSeq);

    expect(whereClause).toContain('seq <= $1');
    expect(params[0]).toBe(maxSeq);
    expect(params[1]).toBe(epochDate.toISOString());
    expect(params[3]).toBe(0n);
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
