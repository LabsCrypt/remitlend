import { FeeBumpTransaction, TransactionBuilder, type Transaction } from '@stellar/stellar-sdk';
import { getStellarNetworkPassphrase } from '../config/stellar.js';
import { AppError } from '../errors/AppError.js';

export interface ParsedSignedEnvelope {
  source: string;
  signatureCount: number;
}

/**
 * Parses and validates a signed transaction envelope encoded as base64 XDR
 * before the signed transaction is ever submitted to the Stellar network.
 *
 * This is the "parse the signed XDR with the Stellar SDK and validate it
 * before submitting" requirement: a malformed XDR or an envelope that carries
 * no signatures (i.e. the wallet never actually signed it) is rejected with a
 * `400 Bad Request` instead of being handed straight to the RPC endpoint. This
 * guarantees the remittance record is never flipped to `processing`/`completed`
 * on the back of an envelope that could not possibly settle on-chain.
 *
 * Returns basic envelope metadata so callers can log / reconcile without
 * re-parsing the XDR.
 *
 * @throws {AppError} with HTTP 400 when the XDR is not a valid transaction
 * envelope or when the envelope contains no signatures.
 */
export function parseAndValidateSignedEnvelope(signedXdr: string): ParsedSignedEnvelope {
  const passphrase = getStellarNetworkPassphrase();

  let transaction: Transaction | FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.fromXDR(signedXdr, passphrase);
  } catch {
    throw AppError.badRequest('Invalid signed XDR: unable to parse the transaction envelope');
  }

  const signatureCount =
    transaction instanceof FeeBumpTransaction
      ? transaction.innerTransaction.signatures.length
      : (transaction as Transaction).signatures.length;

  if (signatureCount === 0) {
    throw AppError.badRequest('Signed XDR must contain at least one signature');
  }

  const source =
    transaction instanceof FeeBumpTransaction
      ? transaction.innerTransaction.source
      : (transaction as Transaction).source;

  return {
    source,
    signatureCount,
  };
}
