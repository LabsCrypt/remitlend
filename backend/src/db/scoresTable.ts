/**
 * Canonical schema definition and column mapping for the `scores` table.
 * Standardized on the migrated column names (`borrower`, `score`).
 * Shared by runtime services and seed scripts to prevent schema drift.
 */
export const SCORES_TABLE = {
  tableName: 'scores',
  columns: {
    id: 'id',
    borrower: 'borrower',
    score: 'score',
    lastDecayedAt: 'last_decayed_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
} as const;

export const SCORES_COLUMNS = SCORES_TABLE.columns;
