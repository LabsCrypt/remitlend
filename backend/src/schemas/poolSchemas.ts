import { z } from "zod";
import { stellarAddressSchema } from "./stellarSchemas.js";
import { submitTxSchema, positiveAmountSchema } from "./loanSchemas.js";

export const buildPoolTransactionSchema = z.object({
  depositorPublicKey: stellarAddressSchema,
  token: stellarAddressSchema,
  amount: positiveAmountSchema,
});

export { submitTxSchema };
