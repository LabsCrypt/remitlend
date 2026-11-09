import { parseCappedLimit } from '../queryHelpers.js';
import type { Request } from 'express';

describe('parseCappedLimit', () => {
  const mockRequest = (query: Record<string, unknown> = {}): Partial<Request> => ({
    query,
  });

  describe('empty filters and missing values', () => {
    it('returns default limit when query object is completely empty', () => {
      const req = mockRequest({}) as Request;
      expect(parseCappedLimit(req)).toBe(20);
    });

    it('returns default limit when limit parameter is undefined', () => {
      const req = mockRequest({ limit: undefined }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit parameter is an empty string', () => {
      const req = mockRequest({ limit: '' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit parameter contains only whitespace', () => {
      const req = mockRequest({ limit: '   ' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });
  });

  describe('null and non-primitive query values', () => {
    it('returns default limit when limit is explicitly null', () => {
      const req = mockRequest({ limit: null }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit is boolean string true or false', () => {
      expect(parseCappedLimit(mockRequest({ limit: 'true' }) as Request, 20)).toBe(20);
      expect(parseCappedLimit(mockRequest({ limit: 'false' }) as Request, 20)).toBe(20);
    });

    it('returns default limit when limit is NaN', () => {
      const req = mockRequest({ limit: NaN }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });
  });

  describe('conflicting operators and query structure injection', () => {
    it('returns default limit when limit is an array of conflicting values', () => {
      const req = mockRequest({ limit: ['10', '50'] }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit is an object with nested operator keys', () => {
      const req = mockRequest({ limit: { gte: '10' } }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit contains MongoDB/SQL style operator strings', () => {
      expect(parseCappedLimit(mockRequest({ limit: '$gt:10' }) as Request, 20)).toBe(20);
      expect(parseCappedLimit(mockRequest({ limit: '>=25' }) as Request, 20)).toBe(20);
    });
  });

  describe('valid limits and MAX_LIMIT capping', () => {
    it('returns provided limit when equal to minimum valid limit (1)', () => {
      const req = mockRequest({ limit: '1' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(1);
    });

    it('returns provided limit when well within MAX_LIMIT', () => {
      const req = mockRequest({ limit: '50' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(50);
    });

    it('returns exactly MAX_LIMIT when limit equals 100', () => {
      const req = mockRequest({ limit: '100' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(100);
    });

    it('caps at MAX_LIMIT when provided limit is just above MAX_LIMIT (101)', () => {
      const req = mockRequest({ limit: '101' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(100);
    });

    it('caps at MAX_LIMIT when provided limit vastly exceeds MAX_LIMIT', () => {
      const req = mockRequest({ limit: '1000000' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(100);
    });
  });

  describe('invalid numeric boundaries and non-integer values', () => {
    it('returns default limit when provided limit is 0', () => {
      const req = mockRequest({ limit: '0' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when provided limit is negative', () => {
      const req = mockRequest({ limit: '-10' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when provided limit is a decimal number', () => {
      const req = mockRequest({ limit: '50.5' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });

    it('returns default limit when limit is Infinity or -Infinity', () => {
      expect(parseCappedLimit(mockRequest({ limit: 'Infinity' }) as Request, 20)).toBe(20);
      expect(parseCappedLimit(mockRequest({ limit: '-Infinity' }) as Request, 20)).toBe(20);
    });

    it('returns default limit when limit is an arbitrary invalid string', () => {
      const req = mockRequest({ limit: 'invalid_param' }) as Request;
      expect(parseCappedLimit(req, 20)).toBe(20);
    });
  });

  describe('custom defaultLimit configuration', () => {
    it('falls back to custom default limit when provided limit is invalid', () => {
      const req = mockRequest({ limit: 'bad_number' }) as Request;
      expect(parseCappedLimit(req, 35)).toBe(35);
    });

    it('falls back to default 20 when defaultLimit argument is omitted', () => {
      const req = mockRequest({ limit: undefined }) as Request;
      expect(parseCappedLimit(req)).toBe(20);
    });
  });
});
