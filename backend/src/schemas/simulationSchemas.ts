import { z } from "zod";

// Schema for GET /history/:userId
export const getRemittanceHistorySchema = z.object({
  params: z.object({
    userId: z
      .string()
      .min(1, "User ID is required")
      .max(100, "User ID is too long"),
  }),
});

// Schema for POST /simulate
export const simulatePaymentSchema = z.object({
  body: z.object({
    userId: z
      .string()
      .min(1, "User ID is required")
      .max(100, "User ID is too long"),
    amount: z
      .number()
      .positive("Amount must be positive")
      .max(1000000, "Amount exceeds maximum limit"),
  }),
});

// Export types for TypeScript
export type GetRemittanceHistoryInput = z.infer<
  typeof getRemittanceHistorySchema
>;
export type SimulatePaymentInput = z.infer<typeof simulatePaymentSchema>;
