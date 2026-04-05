import type { Request } from "express";

export interface CursorQueryParams {
    limit: number;
    cursor: string | null;
    sort: "asc" | "desc";
    status: string | null;
    dateRange: { from: string | null; to: string | null; start: string | null; end: string | null };
    amountRange: { min: number | null; max: number | null };
}

export const parseCursorQueryParams = (req: Request): CursorQueryParams => {
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
    const cursor = req.query["cursor"] ? String(req.query["cursor"]) : null;
    const sort = req.query["sort"] === "asc" ? "asc" : "desc";
    const status = req.query["status"] ? String(req.query["status"]) : null;
    const dateFrom = req.query["dateFrom"] ? String(req.query["dateFrom"]) : null;
    const dateTo = req.query["dateTo"] ? String(req.query["dateTo"]) : null;
    const minAmount = req.query["minAmount"] ? parseFloat(String(req.query["minAmount"])) : null;
    const maxAmount = req.query["maxAmount"] ? parseFloat(String(req.query["maxAmount"])) : null;

    return {
        limit,
        cursor,
        sort,
        status,
        dateRange: { from: dateFrom, to: dateTo, start: dateFrom, end: dateTo },
        amountRange: { min: minAmount, max: maxAmount },
    };
};

export const createCursorPaginatedResponse = (
    data: Record<string, unknown>,
    total: number,
    limit: number,
    count: number,
    nextCursor: string | null,
    hasPrev: boolean,
) => ({
    success: true,
    ...data,
    pagination: {
        total,
        limit,
        count,
        nextCursor,
        hasPrev,
        hasNext: nextCursor !== null,
    },
});
