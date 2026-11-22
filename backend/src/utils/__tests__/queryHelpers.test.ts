import { parseCappedLimit } from '../queryHelpers.js';
import type { Request } from 'express';

describe('parseCappedLimit', () => {
  const mockRequest = (queryLimit: string | undefined): Partial<Request> => ({
    query: { limit: queryLimit },
  });

  it('should return default limit when no limit is provided', () => {
    const req = mockRequest(undefined) as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it('should return provided limit when within MAX_LIMIT', () => {
    const req = mockRequest('50') as Request;
    expect(parseCappedLimit(req, 20)).toBe(50);
  });

  it('should cap at MAX_LIMIT when provided limit exceeds MAX_LIMIT', () => {
    const req = mockRequest('1000000') as Request;
    expect(parseCappedLimit(req, 20)).toBe(100);
  });

  it('should return default limit when provided limit is invalid', () => {
    const req = mockRequest('invalid') as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it('should return default limit when provided limit is negative', () => {
    const req = mockRequest('-10') as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it('should return default limit when provided limit is zero', () => {
    const req = mockRequest('0') as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });

  it('should handle edge case of exactly MAX_LIMIT', () => {
    const req = mockRequest('100') as Request;
    expect(parseCappedLimit(req, 20)).toBe(100);
  });

  it('should handle decimal numbers by treating them as invalid', () => {
    const req = mockRequest('50.5') as Request;
    expect(parseCappedLimit(req, 20)).toBe(20);
  });
});

describe('parseCappedLimit with empty, null, and conflicting filters', () => {
  const mockQuery = (query: Record<string, unknown>): Request => ({ query }) as unknown as Request;

  it('uses the default when the query object has no filter keys', () => {
    expect(parseCappedLimit(mockQuery({}), 20)).toBe(20);
  });

  it('uses the default when the limit filter is empty, null, or undefined', () => {
    expect(parseCappedLimit(mockQuery({ limit: '' }), 20)).toBe(20);
    expect(parseCappedLimit(mockQuery({ limit: null }), 20)).toBe(20);
    expect(parseCappedLimit(mockQuery({ limit: undefined }), 20)).toBe(20);
  });

  it('uses the default when repeated limit filters conflict', () => {
    expect(parseCappedLimit(mockQuery({ limit: ['5', '50'] }), 20)).toBe(20);
  });

  it('uses the default when conflicting limits appear alongside unrelated filters', () => {
    expect(parseCappedLimit(mockQuery({ status: 'open', limit: ['5', '50'] }), 20)).toBe(20);
  });

  it('coerces a single repeated limit filter to its numeric value', () => {
    expect(parseCappedLimit(mockQuery({ limit: ['35'] }), 20)).toBe(35);
  });

  it('ignores unrelated filters when a valid limit is provided', () => {
    expect(parseCappedLimit(mockQuery({ status: 'open', cursor: 'abc', limit: '25' }), 20)).toBe(
      25,
    );
  });
});

describe('parseCappedLimit boundaries and error contract', () => {
  const mockQuery = (limit: unknown): Request => ({ query: { limit } }) as unknown as Request;

  it.each([
    ['minimum positive integer', '1', 1],
    ['whitespace-padded value', ' 42 ', 42],
    ['explicit plus sign', '+25', 25],
    ['one below the cap', '99', 99],
    ['scientific notation at the cap', '1e2', 100],
    ['one above the cap', '101', 100],
  ] as Array<[string, unknown, number]>)('accepts %s', (_label, limit, expected) => {
    expect(parseCappedLimit(mockQuery(limit), 20)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['zero', '0'],
    ['negative zero', '-0'],
    ['negative number', '-10'],
    ['decimal', '50.5'],
    ['positive infinity', 'Infinity'],
    ['negative infinity', '-Infinity'],
    ['NaN', 'NaN'],
    ['non-numeric text', 'invalid'],
    ['conflicting repeated filters', ['5', '50']],
    ['empty repeated filters', []],
    ['object value', {}],
  ] as Array<[string, unknown]>)('falls back to the default for %s', (_label, limit) => {
    expect(parseCappedLimit(mockQuery(limit), 20)).toBe(20);
  });

  it('honors a caller-supplied default for missing and invalid filters', () => {
    expect(parseCappedLimit({ query: {} } as unknown as Request, 7)).toBe(7);
    expect(parseCappedLimit(mockQuery(null), 7)).toBe(7);
  });

  it('caps explicit limits independently of a smaller caller-supplied default', () => {
    expect(parseCappedLimit(mockQuery('250'), 7)).toBe(100);
  });

  it('does not cap a caller-supplied default larger than MAX_LIMIT', () => {
    expect(parseCappedLimit({ query: {} } as unknown as Request, 250)).toBe(250);
  });
});
