import { getClient } from './connection.js';
import logger from '../utils/logger.js';

/**
 * Execute a database transaction with automatic rollback on error
 * @param operations - Array of database operations to execute within the transaction
 * @returns Promise with the result of the operations
 */
export async function withTransaction<T>(
  operations: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  let client;
  try {
    client = await getClient();
  } catch (error) {
    logger.error('Failed to acquire database client for transaction', {
      error,
    });
    throw new Error('Database connection failed');
  }

  if (!client) {
    throw new Error('Database client is undefined');
  }

  try {
    await client.query('BEGIN');
    logger.debug('Database transaction started');

    const result = await operations(client);

    await client.query('COMMIT');
    logger.debug('Database transaction committed');

    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Database transaction rolled back due to error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Execute multiple database operations in a transaction
 * @param queries - Array of queries with their parameters
 * @returns Promise with array of results
 */
export async function executeTransactionQueries(
  queries: Array<{ text: string; params?: unknown[] }>,
): Promise<unknown[]> {
  return withTransaction(async (client) => {
    const results = [];

    for (const query of queries) {
      const result = await client.query(query.text, query.params || []);
      results.push(result);
    }

    return results;
  });
}

/**
 * Wrapper for operations that involve both on-chain submission and database writes
 * @param stellarOperation - Function that submits to Stellar network
 * @param dbOperations - Function that performs database writes
 * @returns Promise with combined result
 */
export async function withStellarAndDbTransaction<T>(
  stellarOperation: () => Promise<unknown>,
  dbOperations: (stellarResult: unknown, client: import('pg').PoolClient) => Promise<T>,
): Promise<{ stellarResult: unknown; dbResult: T }> {
  // Execute Stellar operation outside the DB transaction to avoid holding
  // a pooled connection during network I/O (Stellar RPC can take 30+ seconds).
  let stellarResult: unknown;
  try {
    stellarResult = await stellarOperation();
  } catch (error) {
    logger.error('Stellar operation failed before DB transaction:', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }

  try {
    const dbResult = await withTransaction(async (client) => {
      return await dbOperations(stellarResult, client);
    });
    return { stellarResult, dbResult };
  } catch (error) {
    logger.error('Operation failed in Stellar+DB transaction:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      // Don't log sensitive Stellar data
    });

    // Log for reconciliation since Stellar transaction might have succeeded
    // but DB write failed
    logger.warn('Stellar transaction might need manual reconciliation', {
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}
