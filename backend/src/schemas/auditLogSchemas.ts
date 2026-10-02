import { z } from 'zod';

const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Must be a valid ISO-8601 date string',
});

const limitQueryString = z
  .string()
  .refine((val) => /^\d+$/.test(val) && parseInt(val, 10) > 0, {
    message: 'limit must be a positive integer',
  })
  .optional();

export const getAuditLogsQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  cursor: z.string().optional(),
  limit: limitQueryString,
  withTotal: z.enum(['true', 'false']).optional(),
});

export const getAuditLogsSchema = z.object({
  query: getAuditLogsQuerySchema,
});

export type GetAuditLogsQueryInput = z.infer<typeof getAuditLogsQuerySchema>;
export type GetAuditLogsInput = z.infer<typeof getAuditLogsSchema>;
