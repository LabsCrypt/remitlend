import { roundToCents } from '../controllers/loanController.js';

describe('roundToCents half-even rounding', () => {
  it('applies banker rounding (half-even) for .5 cent cases', () => {
    expect(roundToCents(0.125)).toBe(0.12);
    expect(roundToCents(0.135)).toBe(0.14);
    expect(roundToCents(10.005)).toBe(10.0);
    expect(roundToCents(10.015)).toBe(10.02);
  });

  it('handles negative half-even rounding symmetrically', () => {
    expect(roundToCents(-0.125)).toBe(-0.12);
    expect(roundToCents(-0.135)).toBe(-0.14);
  });

  it('rounds non-tie values to nearest cent', () => {
    expect(roundToCents(10.004)).toBe(10.0);
    expect(roundToCents(10.006)).toBe(10.01);
    expect(roundToCents(12.3456)).toBe(12.35);
    expect(roundToCents(12.3412)).toBe(12.34);
    expect(roundToCents(0.0049)).toBe(0);
  });
});
