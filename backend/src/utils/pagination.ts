import { Request } from "express";

export interface PaginationParams {
  limit: number;
  offset: number;
  sort: string | null;
  status: string | null;
  dateRange: { start: Date; end: Date } | null;
  amountRange: { min: number; max: number } | null;
}

export function parseQueryParams(req: Request): PaginationParams {
  const limitStr = req.query.limit as string;
  const offsetStr = req.query.offset as string;
  const sort = (req.query.sort as string) || null;
  const status = (req.query.status as string) || null;
  const dateRangeStr = req.query.date_range as string;
  const amountRangeStr = req.query.amount_range as string;

  const limit = limitStr && !isNaN(parseInt(limitStr, 10)) ? parseInt(limitStr, 10) : 50;
  const offset = offsetStr && !isNaN(parseInt(offsetStr, 10)) ? parseInt(offsetStr, 10) : 0;

  let dateRange = null;
  if (dateRangeStr && dateRangeStr.includes(",")) {
    const [startStr, endStr] = dateRangeStr.split(",");
    const start = new Date(startStr);
    const end = new Date(endStr);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      dateRange = { start, end };
    }
  }

  let amountRange = null;
  if (amountRangeStr && amountRangeStr.includes(",")) {
    const [minStr, maxStr] = amountRangeStr.split(",");
    const min = parseFloat(minStr);
    const max = parseFloat(maxStr);
    if (!isNaN(min) && !isNaN(max)) {
      amountRange = { min, max };
    }
  }

  return { limit, offset, sort, status, dateRange, amountRange };
}

export function createPaginatedResponse<T>(data: T, totalCount: number, limit: number, offset: number) {
  return {
    success: true,
    data,
    page_info: {
      total_count: totalCount,
      limit,
      offset,
    },
  };
}
