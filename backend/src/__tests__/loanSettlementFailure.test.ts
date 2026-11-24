import test from 'node:test';
import assert from 'node:assert';
import { loadLoanSettlements } from '../controllers/loanController.js';
import * as dbConnection from '../db/connection.js';

test('loadLoanSettlements surfaces settlement-load failure as an error', async () => {
  const originalQuery = dbConnection.query;
  (dbConnection as { query: typeof dbConnection.query }).query = (async () => {
    throw new Error('Database connection failed');
  }) as typeof dbConnection.query;

  try {
    await loadLoanSettlements([123]);
    assert.fail('Expected loadLoanSettlements to throw an error');
  } catch (error: unknown) {
    const err = error as Error;
    assert.strictEqual(err.message, 'Database connection failed');
  } finally {
    (dbConnection as { query: typeof dbConnection.query }).query = originalQuery;
  }
});
