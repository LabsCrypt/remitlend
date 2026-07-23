import { createPaginatedResponse } from '../pagination.js';

describe('createPaginatedResponse', () => {
  it('does not advertise a next page when returned rows reach the total count', () => {
    const response = createPaginatedResponse(['c', 'd'], 4, 2, 2, 2);

    expect(response.page_info.has_next).toBe(false);
  });

  it('advertises a next page only when more rows remain', () => {
    const response = createPaginatedResponse(['a', 'b'], 5, 2, 2, 2);

    expect(response.page_info.has_next).toBe(true);
  });
});