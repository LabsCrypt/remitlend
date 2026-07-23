import { parseQueryParams } from '../pagination.js';

describe('parseQueryParams amount_range', () => {
  it('keeps an already ordered min,max range unchanged', () => {
    const req = { query: { amount_range: '10,100' } } as any;

    expect(parseQueryParams(req).amountRange).toEqual({ min: 10, max: 100 });
  });

  it('swaps an out-of-order max,min range', () => {
    const req = { query: { amount_range: '100,10' } } as any;

    expect(parseQueryParams(req).amountRange).toEqual({ min: 10, max: 100 });
  });
});