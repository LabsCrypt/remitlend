import test from 'node:test';
import assert from 'node:assert';
import { loadLoanSettlements } from '../controllers/loanController.js';
import * as dbConnection from '../db/connection.js';

test('loadLoanSettlements surfaces settlement-load failure as an error', async () => {
  const originalQuery = dbConnection.query;
  (dbConnection as any).query = async () => {
    throw new Error('Database connection failed');
  };

  try {
    await loadLoanSettlements([123]);
    assert.fail('Expected loadLoanSettlements to throw an error');
  } catch (error: any) {
    assert.strictEqual(error.message, 'Database connection failed');
  } finally {
    (dbConnection as any).query = originalQuery;
  }
});
