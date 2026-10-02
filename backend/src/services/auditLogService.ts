import { query } from '../db/connection.js';

export interface AuditLogFilters {
  actor?: string;
  action?: string;
  from?: string;
  to?: string;
  /** Composite keyset cursor: `${created_at.toISOString()}:${id}` (see encodeCursor). */
  cursor?: string;
  limit?: number;
  withTotal?: boolean;
}

/**
 * A cursor has to carry *both* sort keys. The page is ordered by
 * `created_at DESC, id DESC`, so resuming on `id` alone skips or repeats rows
 * whenever two entries share a timestamp — which is exactly what happens with
 * the audit table's high-volume writes (#1808).
 */
const CURSOR_SEPARATOR = ':';

export function encodeCursor(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const id = row.id;
  const createdAt = row.created_at;
  if (id === undefined || id === null || !createdAt) return null;
  const createdAtIso = createdAt instanceof Date ? createdAt.toISOString() : String(createdAt);
  return `${createdAtIso}${CURSOR_SEPARATOR}${String(id)}`;
}

/**
 * Splits a composite cursor. Returns null for anything malformed so a bad
 * cursor degrades to "start from the beginning" instead of paging on a
 * half-parsed value and silently dropping rows.
 */
export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const separatorAt = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separatorAt <= 0) return null;
  const createdAt = cursor.slice(0, separatorAt);
  const id = cursor.slice(separatorAt + 1);
  if (!createdAt || !id) return null;
  if (Number.isNaN(new Date(createdAt).getTime())) return null;
  return { createdAt, id };
}

export async function getAuditLogs(filters: AuditLogFilters) {
  const { actor, action, from, to, cursor, limit = 25, withTotal } = filters;

  // Filters first: these define both the page query and the COUNT(*), so a
  // filtered total can never drift from the rows the page returned (#1808).
  const filterConditions: string[] = [];
  const filterValues: unknown[] = [];

  if (actor) {
    filterConditions.push(`actor = $${filterValues.length + 1}`);
    filterValues.push(actor);
  }

  if (action) {
    filterConditions.push(`action = $${filterValues.length + 1}`);
    filterValues.push(action);
  }

  if (from) {
    filterConditions.push(`created_at >= $${filterValues.length + 1}`);
    filterValues.push(from);
  }

  if (to) {
    filterConditions.push(`created_at <= $${filterValues.length + 1}`);
    filterValues.push(to);
  }

  const values = [...filterValues];
  const conditions = [...filterConditions];

  // Keyset predicate over the full sort key, matching the ORDER BY below
  // exactly — a row-value comparison, so ties on created_at are broken by id
  // in the same direction as the sort (#1808).
  const decoded = decodeCursor(cursor);
  if (decoded) {
    const createdAtParam = `$${values.length + 1}`;
    values.push(decoded.createdAt);
    const idParam = `$${values.length + 1}`;
    values.push(decoded.id);
    conditions.push(`(created_at, id) < (${createdAtParam}, ${idParam})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  values.push(limit + 1);
  const result = await query(
    `SELECT * FROM audit_logs ${whereClause} ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
    values,
  );

  const rows = result.rows as Array<Record<string, unknown>>;
  const hasNext = rows.length > limit;
  const data = rows.slice(0, limit);

  let total: number | undefined;
  if (withTotal === true) {
    // The total reflects the active filters but not the keyset cursor: a total
    // describes the whole filtered result set, not the remaining pages (#1808).
    const filterClause =
      filterConditions.length > 0 ? `WHERE ${filterConditions.join(' AND ')}` : '';
    const countSql = filterClause
      ? `SELECT COUNT(*) as count FROM audit_logs ${filterClause}`
      : 'SELECT COUNT(*) as count FROM audit_logs';
    const countResult = await query(countSql, filterValues);
    total = Number((countResult.rows[0] as Record<string, unknown>)?.count ?? 0);
  }

  return {
    data,
    nextCursor: hasNext ? encodeCursor(data[data.length - 1]) : null,
    total,
  };
}
