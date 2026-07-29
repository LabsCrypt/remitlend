/**
 * Pagination utilities.
 *
 * This module deliberately holds two *complementary* pagination strategies that
 * previously lived in separate files (`lib/pagination.ts` and
 * `utils/pagination.ts`). They were never duplicates — their APIs are disjoint —
 * but two modules with the same filename in sibling folders meant a controller
 * could import the wrong one, and `indexerController.ts` in fact imported from
 * both. Consolidating them removes that ambiguity and lets the shared limits be
 * declared once.
 *
 *  1. **Offset pagination and query parsing** — parses Express query params
 *     (limit/offset/sort/status/date_range/amount_range) and builds response
 *     envelopes. Use for admin-style listings where a total count is wanted.
 *
 *  2. **Keyset (cursor) pagination** — opaque base64url cursors over
 *     (created_at, seq) with a pinned snapshot seq, for feeds that must stay
 *     stable under concurrent writes. Prefer this for user-facing lists.
 *
 * Response shapes and parameter contracts are unchanged from both originals.
 */

import type { Request } from 'express';

import { AppError } from '../errors/AppError.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ── 1. Offset pagination and query parsing ──────────────────────────────────

export interface PaginationParams {
  limit: number;
  offset: number;
  sort: string | null;
  status: string | null;
  dateRange: { start: Date; end: Date } | null;
  amountRange: { min: number; max: number } | null;
}

export interface CursorPaginationParams {
  limit: number;
  cursor: string | null;
  sort: string | null;
  status: string | null;
  dateRange: { start: Date; end: Date } | null;
  amountRange: { min: number; max: number } | null;
}

export interface SortConfig {
  field: string;
  direction: 'ASC' | 'DESC';
}

export function parseQueryParams(req: Request): PaginationParams {
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parsePositiveInteger(req.query.offset, 0);
  const sort =
    typeof req.query.sort === 'string' && req.query.sort.trim().length > 0
      ? req.query.sort.trim()
      : null;
  const status =
    typeof req.query.status === 'string' && req.query.status.trim().length > 0
      ? req.query.status.trim()
      : null;

  return {
    limit,
    offset,
    sort,
    status,
    dateRange: parseDateRange(req.query.date_range),
    amountRange: parseAmountRange(req.query.amount_range),
  };
}

export function parseCursorQueryParams(req: Request): CursorPaginationParams {
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const cursor =
    typeof req.query.cursor === 'string' && req.query.cursor.trim().length > 0
      ? req.query.cursor.trim()
      : null;
  const sort =
    typeof req.query.sort === 'string' && req.query.sort.trim().length > 0
      ? req.query.sort.trim()
      : null;
  const status =
    typeof req.query.status === 'string' && req.query.status.trim().length > 0
      ? req.query.status.trim()
      : null;

  return {
    limit,
    cursor,
    sort,
    status,
    dateRange: parseDateRange(req.query.date_range),
    amountRange: parseAmountRange(req.query.amount_range),
  };
}

export function getSortConfig(
  sort: string | null,
  allowedFields: readonly string[],
  defaultField: string,
  defaultDirection: 'ASC' | 'DESC',
): SortConfig {
  if (!sort) {
    return { field: defaultField, direction: defaultDirection };
  }

  const requestedField = sort.replace(/^-/, '');
  if (!allowedFields.includes(requestedField)) {
    return { field: defaultField, direction: defaultDirection };
  }

  return {
    field: requestedField,
    direction: sort.startsWith('-') ? 'DESC' : 'ASC',
  };
}

export function createPaginatedResponse<T>(
  data: T,
  totalCount: number,
  limit: number,
  offset: number,
  currentCount: number,
) {
  return {
    success: true,
    data,
    total_count: totalCount,
    page_info: {
      limit,
      offset,
      count: currentCount,
      has_previous: offset > 0,
      has_next: offset + currentCount < totalCount,
    },
  };
}

export function createCursorPaginatedResponse<T>(
  data: T,
  totalCount: number | null,
  limit: number,
  currentCount: number,
  nextCursor: string | null,
  hasPrevious: boolean,
) {
  return {
    success: true,
    data,
    total_count: totalCount,
    page_info: {
      limit,
      count: currentCount,
      next_cursor: nextCursor,
      has_previous: hasPrevious,
      has_next: nextCursor !== null,
    },
  };
}

function parsePositiveInteger(value: unknown, fallback: number, max?: number): number {
  if (typeof value !== 'string') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  if (max !== undefined) {
    return Math.min(parsed, max);
  }

  return parsed;
}

function parseDateRange(value: unknown): { start: Date; end: Date } | null {
  if (typeof value !== 'string') {
    return null;
  }

  const [startRaw, endRaw] = value.split(',').map((part) => part?.trim());
  if (!startRaw || !endRaw) {
    return null;
  }

  const start = new Date(startRaw);
  const end = new Date(endRaw);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  return start <= end ? { start, end } : { start: end, end: start };
}

function parseAmountRange(value: unknown): { min: number; max: number } | null {
  if (typeof value !== 'string') {
    return null;
  }

  const [minRaw, maxRaw] = value.split(',').map((part) => part?.trim());
  if (!minRaw || !maxRaw) {
    return null;
  }

  const min = Number.parseFloat(minRaw);
  const max = Number.parseFloat(maxRaw);

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return min <= max ? { min, max } : { min: max, max: min };
}

// ── 2. Keyset (cursor) pagination ───────────────────────────────────────────

/**
 * Encodes a cursor as a base64url string.
 * The cursor format is: base64url(JSON.stringify({ createdAt: ISO8601, seq: string }))
 *
 * @param createdAt - The created_at timestamp of the row
 * @param seq - The seq value of the row
 * @returns Opaque base64url-encoded cursor string
 */
export function encodeCursor(createdAt: Date, seq: bigint): string {
  const payload = {
    createdAt: createdAt.toISOString(),
    seq: String(seq),
  };
  const json = JSON.stringify(payload);
  return base64urlEncode(json);
}

/**
 * Decodes a base64url cursor.
 *
 * @param cursor - Base64url-encoded cursor string
 * @returns Decoded cursor with createdAt and seq
 * @throws AppError with code INVALID_CURSOR if the cursor is malformed
 */
export function decodeCursor(cursor: string): DecodedCursor {
  try {
    const json = base64urlDecode(cursor);
    const payload = JSON.parse(json) as Record<string, unknown>;

    if (!payload.createdAt || typeof payload.createdAt !== 'string') {
      throw new Error('Missing or invalid createdAt');
    }

    if (!payload.seq || typeof payload.seq !== 'string') {
      throw new Error('Missing or invalid seq');
    }

    const createdAt = new Date(payload.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error('Invalid createdAt date');
    }

    const seq = BigInt(payload.seq);

    return { createdAt, seq };
  } catch (error) {
    throw AppError.badRequest(
      `Invalid cursor: ${error instanceof Error ? error.message : 'unknown error'}`,
      {
        code: 'INVALID_CURSOR',
      },
    );
  }
}

/**
 * Builds a keyset pagination WHERE clause for a SQL query.
 *
 * The clause ensures:
 * 1. Only rows within the snapshot are visible (seq <= snapshotSeq)
 * 2. Rows are ordered by (created_at DESC, seq DESC)
 * 3. The page window is seeked past the cursor
 *
 * @param cursor - Decoded cursor from the previous page, or null for the first page
 * @param snapshotSeq - The snapshot seq pinned at first request
 * @param columnPrefix - Optional prefix for column names (e.g. "t." for table alias)
 * @returns SQL WHERE clause fragment and parameter values
 *
 * @example
 * const { whereClause, params } = buildKeysetClause(cursor, snapshotSeq);
 * const query = `
 *   SELECT * FROM remittances
 *   WHERE ${whereClause}
 *   ORDER BY created_at DESC, seq DESC
 *   LIMIT $${params.length + 1}
 * `;
 * const fullParams = [...params, limit];
 */
export function buildKeysetClause(
  cursor: DecodedCursor | null,
  snapshotSeq: bigint,
  columnPrefix: string = '',
): {
  whereClause: string;
  params: (string | number | bigint)[];
} {
  const cols = (col: string) => (columnPrefix ? `${columnPrefix}.${col}` : col);
  const params: (string | number | bigint)[] = [];

  // Snapshot constraint: only rows up to the pinned seq are visible
  let whereClause = `${cols('seq')} <= $${params.length + 1}`;
  params.push(snapshotSeq);

  // Keyset seek constraint: rows strictly less than the cursor
  if (cursor) {
    // WHERE (created_at, seq) < (cursorCreatedAt, cursorSeq)
    // Expanded to: created_at < cursorCreatedAt OR (created_at = cursorCreatedAt AND seq < cursorSeq)
    whereClause += ` AND (${cols('created_at')} < $${params.length + 1} OR (${cols('created_at')} = $${params.length + 2} AND ${cols('seq')} < $${params.length + 3}))`;
    params.push(cursor.createdAt.toISOString());
    params.push(cursor.createdAt.toISOString());
    params.push(cursor.seq);
  }

  return { whereClause, params };
}

/**
 * Parses and validates keyset pagination query parameters.
 *
 * @param snapshotSeq - The snapshot_seq from query params (may be from first request or subsequent)
 * @param cursor - The cursor from query params (null for first page)
 * @param limit - The limit from query params
 * @returns Validated KeysetPaginationParams
 */
export function parseKeysetParams(
  snapshotSeq: string | number | null | undefined,
  cursor: string | null | undefined,
  limit: string | number | null | undefined,
): KeysetPaginationParams {
  // Parse snapshot_seq
  let parsedSnapshotSeq: bigint;
  if (snapshotSeq === null || snapshotSeq === undefined || snapshotSeq === '') {
    // First request; will be pinned by the handler
    parsedSnapshotSeq = BigInt(0);
  } else {
    try {
      parsedSnapshotSeq = BigInt(snapshotSeq);
    } catch {
      throw AppError.badRequest('Invalid snapshot_seq', { code: 'INVALID_SNAPSHOT_SEQ' });
    }
  }

  // Parse cursor
  const parsedCursor =
    cursor && typeof cursor === 'string' && cursor.trim().length > 0 ? cursor.trim() : null;

  // Parse limit
  let parsedLimit = DEFAULT_LIMIT;
  if (limit !== null && limit !== undefined && limit !== '') {
    const numLimit = typeof limit === 'number' ? limit : Number.parseInt(String(limit), 10);
    if (!Number.isFinite(numLimit) || numLimit < 1) {
      parsedLimit = DEFAULT_LIMIT;
    } else {
      parsedLimit = Math.min(numLimit, MAX_LIMIT);
    }
  }

  return {
    snapshotSeq: parsedSnapshotSeq,
    cursor: parsedCursor,
    limit: parsedLimit,
  };
}

/**
 * Base64url encoder (RFC 4648 section 5).
 */
function base64urlEncode(str: string): string {
  const buf = Buffer.from(str, 'utf-8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64url decoder (RFC 4648 section 5).
 */
function base64urlDecode(str: string): string {
  // Add padding if needed
  const padded = str.padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');
  const buf = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return buf.toString('utf-8');
}
