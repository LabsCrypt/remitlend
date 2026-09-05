import { z } from 'zod';
import { stellarAddressSchema } from './stellarSchemas.js';

export const rejectLoanSchema = z.object({
  reason: z
    .string()
    .min(5, 'Reason must be at least 5 characters')
    .max(500, 'Reason cannot exceed 500 characters'),
});

export type RejectLoanInput = z.infer<typeof rejectLoanSchema>;

export const positiveAmountSchema = z.number().int().positive('Amount must be a positive integer');

const base64Regex = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const requestLoanSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: stellarAddressSchema,
  term: z.number().int().positive('Term must be a positive integer').optional(),
});

export const repayLoanSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: stellarAddressSchema,
});

export const previewAmortizationSchema = z.object({
  amount: positiveAmountSchema,
  termDays: z.union([z.literal(30), z.literal(60), z.literal(90)]),
});

export const repayLoanParamsSchema = z.object({
  loanId: z.coerce.number().int().positive('Loan ID must be a positive integer'),
});

export const submitTxSchema = z.object({
  signedTxXdr: z
    .string()
    .min(1, 'signedTxXdr is required')
    .regex(base64Regex, 'Must be a valid base64 string'),
});

export const depositCollateralSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: stellarAddressSchema,
});

export const releaseCollateralSchema = z.object({
  borrowerPublicKey: stellarAddressSchema,
});

export const refinanceLoanSchema = z.object({
  newAmount: positiveAmountSchema,
  newTerm: z.number().int().positive('Term must be a positive integer'),
  borrowerPublicKey: stellarAddressSchema,
});

export const extendLoanSchema = z.object({
  extraLedgers: z.number().int().positive('Extra ledgers must be a positive integer'),
  borrowerPublicKey: stellarAddressSchema,
});

export const liquidateLoanSchema = z.object({
  liquidatorPublicKey: stellarAddressSchema,
});

/**
 * Validated query params for GET /loans/borrower/:borrower.
 * `status`  – one of the five loan statuses or "all" (default all)
 * `from`    – ISO-8601 date string (start of approved_at range)
 * `to`      – ISO-8601 date string (end of approved_at range)
 * `limit`   – page size (default 50, max 100)
 * `cursor`  – opaque cursor (loan_id string from previous response)
 */
const isoDateString = z.string().refine((val) => !Number.isNaN(Date.parse(val)), {
  message: 'Must be a valid ISO-8601 date string',
});

export const borrowerLoansQuerySchema = z.object({
  status: z.enum(['active', 'repaid', 'defaulted', 'liquidated', 'pending', 'all']).optional(),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});
