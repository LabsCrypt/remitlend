import { z } from "zod";
import { Address } from "@stellar/stellar-sdk";
import { stellarAddressSchema } from "./stellarSchemas.js";
import { submitTxSchema, positiveAmountSchema } from "./loanSchemas.js";

export const buildPoolTransactionSchema = z.object({
  depositorPublicKey: stellarAddressSchema,
  token: stellarAddressSchema,
  amount: positiveAmountSchema,
});

export const poolSharePriceParamSchema = z.object({
  params: z.object({
    token: z
      .string()
      .min(1, "Token address is required")
      .refine((value) => {
        try {
          Address.fromString(value);
          return true;
        } catch {
          return false;
        }
      }, "Invalid Stellar token address format"),
  }),
});

export { submitTxSchema };
