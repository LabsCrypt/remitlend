import type { Request } from "express";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface PaginationParams {
  limit: number;
  offset: number;
  sort: string | null;
  status: string | null;
  dateRange: { start: Date; end: Date } | null;
  amountRange: { min: number; max: number } | null;
}

export interface SortConfig {
  field: string;
  direction: "ASC" | "DESC";
}

export function parseQueryParams(req: Request): PaginationParams {
  const limit = parsePositiveInteger(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parsePositiveInteger(req.query.offset, 0);
  const sort =
    typeof req.query.sort === "string" && req.query.sort.trim().length > 0
      ? req.query.sort.trim()
      : null;
  const status =
    typeof req.query.status === "string" && req.query.status.trim().length > 0
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

export function getSortConfig(
  sort: string | null,
  allowedFields: readonly string[],
  defaultField: string,
  defaultDirection: "ASC" | "DESC",
): SortConfig {
  if (!sort) {
    return { field: defaultField, direction: defaultDirection };
  }

  const requestedField = sort.replace(/^-/, "");
  if (!allowedFields.includes(requestedField)) {
    return { field: defaultField, direction: defaultDirection };
  }

  return {
    field: requestedField,
    direction: sort.startsWith("-") ? "DESC" : "ASC",
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

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  max?: number,
): number {
  if (typeof value !== "string") {
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
  if (typeof value !== "string") {
    return null;
  }

  const [startRaw, endRaw] = value.split(",").map((part) => part?.trim());
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
  if (typeof value !== "string") {
    return null;
  }

  const [minRaw, maxRaw] = value.split(",").map((part) => part?.trim());
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
