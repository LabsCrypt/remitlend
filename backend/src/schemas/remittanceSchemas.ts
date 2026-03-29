import { z } from "zod";

// Stellar address regex (56 chars, starts with G, base32)
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{54}$/;

// Schema for POST /remittances
export const createRemittanceSchema = z.object({
  body: z.object({
    recipientAddress: z
      .string()
      .regex(STELLAR_ADDRESS_REGEX, "Invalid Stellar address format")
      .describe("Recipient's Stellar public key"),
    amount: z
      .number()
      .positive("Amount must be greater than 0")
      .max(1_000_000, "Amount exceeds maximum limit")
      .describe("Amount to send"),
    fromCurrency: z
      .enum(["USDC", "EURC", "PHP"])
      .describe("Source currency"),
    toCurrency: z
      .enum(["USDC", "EURC", "PHP"])
      .describe("Destination currency"),
    memo: z
      .string()
      .max(28, "Memo must be 28 characters or less")
      .optional()
      .describe("Optional transaction memo"),
  }),
});

// Schema for GET /remittances (list)
export const getRemittancesSchema = z.object({
  query: z.object({
    limit: z
      .string()
      .transform((v) => Math.min(parseInt(v, 10), 100))
      .pipe(z.number())
      .default(20)
      .optional(),
    offset: z
      .string()
      .transform((v) => Math.max(parseInt(v, 10), 0))
      .pipe(z.number())
      .default(0)
      .optional(),
    status: z
      .enum(["all", "pending", "processing", "completed", "failed"])
      .default("all")
      .optional(),
  }),
});

// Schema for GET /remittances/:id
export const getRemittanceSchema = z.object({
  params: z.object({
    id: z
      .string()
      .min(1, "Remittance ID is required")
      .describe("Remittance ID (UUID format)"),
  }),
});

// Export types for TypeScript
export type CreateRemittanceInput = z.infer<typeof createRemittanceSchema>;
export type GetRemittancesInput = z.infer<typeof getRemittancesSchema>;
export type GetRemittanceInput = z.infer<typeof getRemittanceSchema>;
