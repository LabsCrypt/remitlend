import { loadLoanSettlements } from '../loanController.js';
import { query } from '../../db/connection.js';
import assert from 'assert';

jest.mock('../../db/connection.js', () => ({
  query: jest.fn(),
}));

describe('loadLoanSettlements error handling', () => {
  it('propagates database query failures instead of swallowing them', async () => {
    (query as jest.Mock).mockRejectedValueOnce(new Error('DB connection error'));

    await assert.rejects(
      async () => {
        await loadLoanSettlements([123]);
      },
      {
        message: 'DB connection error',
      },
    );
  });
});
