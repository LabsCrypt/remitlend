import { z } from "zod";

// Schema for GET /score/:userId
export const getScoreSchema = z.object({
  params: z.object({
    userId: z
      .string()
      .min(1, "User ID is required")
      .max(100, "User ID is too long"),
  }),
});

// Schema for POST /score/update
export const updateScoreSchema = z.object({
  body: z.object({
    userId: z
      .string()
      .min(1, "User ID is required")
      .max(100, "User ID is too long"),
    repaymentAmount: z
      .number()
      .positive("Repayment amount must be positive")
      .max(1_000_000, "Repayment amount exceeds maximum limit"),
    onTime: z.boolean({
      message: "onTime must be a boolean",
    }),
  }),
});

// TypeScript types
export type GetScoreInput = z.infer<typeof getScoreSchema>;
export type UpdateScoreInput = z.infer<typeof updateScoreSchema>;
