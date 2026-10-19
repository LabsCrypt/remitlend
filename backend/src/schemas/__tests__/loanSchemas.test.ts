import { describe, expect, it } from '@jest/globals';
import { positiveAmountSchema } from '../loanSchemas.js';

describe('positiveAmountSchema', () => {
  it('accepts positive fractional currency amounts', () => {
    expect(positiveAmountSchema.parse(25.5)).toBe(25.5);
    expect(positiveAmountSchema.parse(100.75)).toBe(100.75);
  });

  it('still rejects zero, negative, and non-numeric amounts', () => {
    expect(positiveAmountSchema.safeParse(0).success).toBe(false);
    expect(positiveAmountSchema.safeParse(-1.25).success).toBe(false);
    expect(positiveAmountSchema.safeParse('25.50').success).toBe(false);
  });
});
