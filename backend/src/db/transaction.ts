import { getClient } from "./connection.js";
import logger from "../utils/logger.js";

/**
 * Execute a database transaction with automatic rollback on error
 * @param operations - Array of database operations to execute within the transaction
 * @returns Promise with the result of the operations
 */
export async function withTransaction<T>(
  operations: (client: any) => Promise<T>
): Promise<T> {
  const client = await getClient();
  
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
  queries: Array<{ text: string; params?: unknown[] }>
): Promise<any[]> {
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
  stellarOperation: () => Promise<any>,
  dbOperations: (stellarResult: any, client: any) => Promise<T>
): Promise<{ stellarResult: any; dbResult: T }> {
  return withTransaction(async (client) => {
    try {
      // Execute Stellar operation first
      const stellarResult = await stellarOperation();
      
      // Then execute database operations with the Stellar result
      const dbResult = await dbOperations(stellarResult, client);
      
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
  });
}
