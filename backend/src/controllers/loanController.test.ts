import { loadLoanSettlements } from './loanController.js';
import { query } from '../db/connection.js';

jest.mock('../db/connection.js', () => ({
  query: jest.fn(),
}));

describe('loadLoanSettlements', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('propagates database query failures instead of returning empty lists', async () => {
    (query as jest.Mock).mockRejectedValueOnce(new Error('DB connection lost'));

    await expect(loadLoanSettlements([1, 2])).rejects.toThrow('DB connection lost');
  });
});
