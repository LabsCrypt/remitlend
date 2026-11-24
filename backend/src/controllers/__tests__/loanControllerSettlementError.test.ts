import test from 'node:test';
import assert from 'node:assert';
import { loadLoanSettlements } from '../loanController.js';
import * as dbModule from '../../db/connection.js';

test('loadLoanSettlements error propagation', async () => {
  const originalQuery = dbModule.query;
  (dbModule as any).query = async () => {
    throw new Error('Database query failed');
  };

  try {
    await loadLoanSettlements('loan-123');
    assert.fail('Expected loadLoanSettlements to throw an error');
  } catch (err: any) {
    assert.strictEqual(err.message, 'Database query failed');
  } finally {
    (dbModule as any).query = originalQuery;
  }
});
