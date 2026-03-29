import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";

/**
 * Zod schema for a Stellar Ed25519 public key (G... address).
 * Uses StrKey.isValidEd25519PublicKey from @stellar/stellar-sdk for
 * authoritative format validation.
 */
export const stellarAddressSchema = z
  .string()
  .min(1, "Stellar address is required")
  .refine(
    (val) => StrKey.isValidEd25519PublicKey(val),
    "Invalid Stellar address format",
  );

/** Param schema for routes with a :borrower path parameter. */
export const borrowerParamSchema = z.object({
  params: z.object({
    borrower: stellarAddressSchema,
  }),
});

/** Param schema for routes with a :address path parameter. */
export const addressParamSchema = z.object({
  params: z.object({
    address: stellarAddressSchema,
  }),
});

export type StellarAddress = z.infer<typeof stellarAddressSchema>;
