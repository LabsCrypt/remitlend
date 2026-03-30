import type { Request } from "express";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * Safely parses and caps a limit query parameter to prevent database performance issues.
 * 
 * @param req - Express request object
 * @param defaultLimit - Default limit to use if not provided (default: 20)
 * @returns Effective limit that's capped at MAX_LIMIT (100)
 */
export function parseCappedLimit(req: Request, defaultLimit: number = DEFAULT_LIMIT): number {
  const rawLimit = Number(req.query.limit);
  
  if (!Number.isFinite(rawLimit) || rawLimit <= 0 || rawLimit !== Math.floor(rawLimit)) {
    return defaultLimit;
  }
  
  return Math.min(rawLimit, MAX_LIMIT);
}
