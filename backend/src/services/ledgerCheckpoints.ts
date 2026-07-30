import { query } from '../db/connection.js';
import logger from '../utils/logger.js';

/**
 * Whether any ledger range for `contract` is currently flagged `'suspect'`
 * by the indexer's contiguous-cursor checkpoint table (see
 * `EventIndexer.recordCheckpoint` in `eventIndexer.ts`). A consumer that
 * draws conclusions from indexed events — e.g. `defaultChecker.ts` deciding
 * a loan was never repaid — should treat events in a suspect window as
 * unreliable until the gap is reconciled (issue #1376).
 *
 * Deliberately kept in its own module, separate from `eventIndexer.ts`:
 * `defaultChecker.ts` needs this single query but not the rest of the
 * indexer's dependency graph (Soroban RPC client, webhook/notification/
 * event-stream services, etc.) — importing `eventIndexer.js` directly would
 * pull all of that in transitively for a consumer that only wants to key
 * off `LOAN_MANAGER_CONTRACT_ID` and ask "is there a gap right now?".
 *
 * Fails open (returns `false`) on a query error so a checkpoint-table
 * hiccup does not, by itself, block downstream processing; the error is
 * logged for operator visibility instead.
 */
export async function hasUnresolvedLedgerGaps(contract: string): Promise<boolean> {
  try {
    const result = await query(
      `SELECT EXISTS (
         SELECT 1 FROM ledger_checkpoints WHERE contract = $1 AND status = 'suspect'
       ) AS has_suspect`,
      [contract],
    );
    return Boolean((result.rows[0] as { has_suspect?: boolean } | undefined)?.has_suspect);
  } catch (error) {
    logger
      .withContext()
      .warn(
        'Failed to check for unresolved ledger gaps; proceeding without the suspect-range gate',
        {
          contract,
          error,
        },
      );
    return false;
  }
}
