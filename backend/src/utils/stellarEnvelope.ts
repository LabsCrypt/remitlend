import {
  FeeBumpTransaction,
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk';
import { getStellarNetworkPassphrase } from '../config/stellar.js';
import { AppError } from '../errors/AppError.js';

export interface ParsedSignedEnvelope {
  source: string;
  signatureCount: number;
  sequence: string;
}

export interface EnvelopeValidationOptions {
  /** Rejects envelopes whose sequence does not match the caller's expected value. */
  expectedSequence?: string | bigint;
  /** Rejects envelopes whose source does not match the caller's expected account. */
  expectedSource?: string;
}

type DecoratedSignature = Transaction['signatures'][number];

const ED25519_SIGNATURE_BYTES = 64;

const ALTERNATE_PASSPHRASE: Record<string, string | undefined> = {
  [Networks.TESTNET]: Networks.PUBLIC,
  [Networks.PUBLIC]: Networks.TESTNET,
};

const hasMalformedSignature = (signatures: DecoratedSignature[]): boolean =>
  signatures.some(
    (signature) =>
      signature.hint().length !== 4 || signature.signature().length !== ED25519_SIGNATURE_BYTES,
  );

const isSignedBy = (transaction: Transaction | FeeBumpTransaction, signer: string): boolean => {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(signer);
  } catch {
    return false;
  }

  const hash = transaction.hash();
  return transaction.signatures.some((signature) => {
    if (!signature.hint().equals(keypair.signatureHint())) return false;
    try {
      return keypair.verify(hash, signature.signature());
    } catch {
      return false;
    }
  });
};

const hasValidSignatures = (transaction: Transaction | FeeBumpTransaction): boolean => {
  try {
    if (transaction instanceof FeeBumpTransaction) {
      return (
        isSignedBy(transaction, transaction.feeSource) &&
        isSignedBy(transaction.innerTransaction, transaction.innerTransaction.source)
      );
    }

    return isSignedBy(transaction, transaction.source);
  } catch {
    return false;
  }
};

const isSignedForPassphrase = (
  signedXdr: string,
  passphrase: string,
  signatures: DecoratedSignature[],
): boolean => {
  if (hasMalformedSignature(signatures)) return false;

  try {
    return hasValidSignatures(TransactionBuilder.fromXDR(signedXdr, passphrase));
  } catch {
    return false;
  }
};

/**
 * Parses and validates a signed transaction envelope encoded as base64 XDR
 * before the signed transaction is ever submitted to the Stellar network.
 *
 * Validation is deterministic and offline: the envelope must parse with the
 * configured network passphrase, carry at least one well-formed signature, and
 * be cryptographically signed by the envelope source (and fee source, for a
 * fee bump) for that network. Callers can additionally pin the expected
 * sequence and source to reject stale or misrouted envelopes.
 *
 * @throws {AppError} with HTTP 400 for every rejected envelope.
 */
export function parseAndValidateSignedEnvelope(
  signedXdr: string,
  options: EnvelopeValidationOptions = {},
): ParsedSignedEnvelope {
  const passphrase = getStellarNetworkPassphrase();

  let transaction: Transaction | FeeBumpTransaction;
  try {
    transaction = TransactionBuilder.fromXDR(signedXdr, passphrase);
  } catch {
    throw AppError.validation(
      'Invalid signed XDR: unable to parse the transaction envelope',
      'signedXdr',
    );
  }

  const innerTransaction =
    transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
  const signatures = transaction.signatures;
  const signatureCount = innerTransaction.signatures.length;

  if (signatureCount === 0) {
    throw AppError.validation('Signed XDR must contain at least one signature', 'signedXdr');
  }

  if (hasMalformedSignature(signatures) || hasMalformedSignature(innerTransaction.signatures)) {
    throw AppError.validation('Signed XDR contains a malformed signature', 'signedXdr');
  }

  if (options.expectedSequence !== undefined) {
    const expected = BigInt(options.expectedSequence).toString();
    if (innerTransaction.sequence !== expected) {
      throw AppError.validation('Signed XDR has a stale sequence number', 'expectedSequence');
    }
  }

  if (options.expectedSource !== undefined && innerTransaction.source !== options.expectedSource) {
    throw AppError.validation(
      'Signed XDR source does not match the expected account',
      'expectedSource',
    );
  }

  if (!hasValidSignatures(transaction)) {
    const alternatePassphrase = ALTERNATE_PASSPHRASE[passphrase];
    if (alternatePassphrase && isSignedForPassphrase(signedXdr, alternatePassphrase, signatures)) {
      throw AppError.validation('Signed XDR was signed for the wrong Stellar network', 'signedXdr');
    }
    throw AppError.validation('Signed XDR does not contain a valid signature', 'signedXdr');
  }

  return {
    source: innerTransaction.source,
    signatureCount,
    sequence: innerTransaction.sequence,
  };
}
