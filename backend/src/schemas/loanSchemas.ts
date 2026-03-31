import { z } from "zod";

export const positiveAmountSchema = z.number({
}).int().positive("Amount must be a positive integer");

export const requestLoanSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: z.string().min(1, "borrowerPublicKey is required"),
});

export const repayLoanSchema = z.object({
  amount: positiveAmountSchema,
  borrowerPublicKey: z.string().min(1, "borrowerPublicKey is required"),
});

export const repayLoanParamsSchema = z.object({
  loanId: z.coerce.number().int().positive("Loan ID must be a positive integer"),
});

export const submitTxSchema = z.object({
  signedTxXdr: z.string().min(1, "signedTxXdr is required"),
});
