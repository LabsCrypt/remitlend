import { parseCappedLimit } from '../utils/queryHelpers.js';

describe('parseCappedLimit', () => {
  it('falls back to the default limit when limit is zero', () => {
    const req = { query: { limit: '0' } } as any;

    expect(parseCappedLimit(req, 25)).toBe(25);
  });

  it('caps positive integer limits at the maximum', () => {
    const req = { query: { limit: '250' } } as any;

    expect(parseCappedLimit(req, 25)).toBe(100);
  });
});