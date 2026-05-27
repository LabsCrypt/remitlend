import { z } from "zod";
import { stellarAddressSchema } from "./stellarSchemas.js";

export const positiveAmountSchema = z
  .number()
  .int()
  .positive("Amount must be a positive integer");

const base64Regex =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const requestLoanSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: stellarAddressSchema,
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
  loanId: z.coerce
    .number()
    .int()
    .positive("Loan ID must be a positive integer"),
});

export const submitTxSchema = z.object({
  signedTxXdr: z
    .string()
    .min(1, "signedTxXdr is required")
    .regex(base64Regex, "Must be a valid base64 string"),
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
  newTerm: z.number().int().positive("Term must be a positive integer"),
  borrowerPublicKey: stellarAddressSchema,
});

export const extendLoanSchema = z.object({
  extraLedgers: z
    .number()
    .int()
    .positive("Extra ledgers must be a positive integer"),
  borrowerPublicKey: stellarAddressSchema,
});
