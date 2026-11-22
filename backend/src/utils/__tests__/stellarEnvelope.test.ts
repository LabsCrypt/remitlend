import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk';
import { AppError } from '../../errors/AppError.js';
import { ErrorCode } from '../../errors/errorCodes.js';
import { parseAndValidateSignedEnvelope } from '../stellarEnvelope.js';

describe('parseAndValidateSignedEnvelope', () => {
  const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
  const secondSigner = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
  const feeSource = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
  const destination = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
  const sequence = '12345';

  const originalEnv = { ...process.env };

  const buildTransaction = (
    passphrase: string = Networks.TESTNET,
    txSequence: string = sequence,
  ): Transaction => {
    const account = new Account(signer.publicKey(), (BigInt(txSequence) - 1n).toString());

    return new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: passphrase,
    })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();
  };

  const buildXdr = (
    options: {
      sign?: boolean;
      passphrase?: string;
      sequence?: string;
      additionalSigners?: Keypair[];
      corruptSignature?: boolean;
      truncateSignature?: boolean;
    } = {},
  ): string => {
    const transaction = buildTransaction(options.passphrase, options.sequence);

    if (options.sign !== false) {
      transaction.sign(signer);
      for (const extraSigner of options.additionalSigners ?? []) {
        transaction.sign(extraSigner);
      }

      const signature = transaction.signatures[0];
      if (signature) {
        if (options.truncateSignature) {
          signature.signature(Buffer.from([1, 2, 3]));
        } else if (options.corruptSignature) {
          const corrupted = Buffer.from(signature.signature());
          const firstByte = corrupted[0];
          if (firstByte !== undefined) corrupted[0] = firstByte ^ 0xff;
          signature.signature(corrupted);
        }
      }
    }

    return transaction.toXDR();
  };

  const buildFeeBumpXdr = (signInner: boolean): string => {
    const innerTransaction = buildTransaction();
    if (signInner) innerTransaction.sign(signer);

    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      '200',
      innerTransaction,
      Networks.TESTNET,
    );
    feeBumpTransaction.sign(feeSource);

    return feeBumpTransaction.toXDR();
  };

  const expectBadRequest = (parse: () => unknown, message: string): void => {
    let thrown: unknown;
    try {
      parse();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    const appError = thrown as AppError;
    expect(appError.statusCode).toBe(400);
    expect(appError.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    expect(appError.message).toContain(message);
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_RPC_URL = 'https://soroban-testnet.stellar.org';
    delete process.env.STELLAR_NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('accepted envelopes', () => {
    it('returns the source, signature count, and sequence for a signed envelope', () => {
      expect(parseAndValidateSignedEnvelope(buildXdr())).toEqual({
        source: signer.publicKey(),
        signatureCount: 1,
        sequence,
      });
    });

    it('accepts additional valid signatures without changing the source', () => {
      expect(
        parseAndValidateSignedEnvelope(buildXdr({ additionalSigners: [secondSigner] })),
      ).toEqual({
        source: signer.publicKey(),
        signatureCount: 2,
        sequence,
      });
    });

    it('accepts a fee bump whose inner and outer transactions are both signed', () => {
      expect(parseAndValidateSignedEnvelope(buildFeeBumpXdr(true))).toEqual({
        source: signer.publicKey(),
        signatureCount: 1,
        sequence,
      });
    });

    it('accepts sequence boundaries when no expected sequence is pinned', () => {
      expect(parseAndValidateSignedEnvelope(buildXdr({ sequence: '0' })).sequence).toBe('0');
      expect(
        parseAndValidateSignedEnvelope(buildXdr({ sequence: '9223372036854775807' })).sequence,
      ).toBe('9223372036854775807');
    });
  });

  describe('replay and network checks', () => {
    it('rejects an envelope signed for the opposite network with a 400', () => {
      const mainnetXdr = buildXdr({ passphrase: Networks.PUBLIC });

      expectBadRequest(
        () => parseAndValidateSignedEnvelope(mainnetXdr),
        'signed for the wrong Stellar network',
      );
    });

    it('rejects a stale sequence when the caller pins the expected sequence', () => {
      const staleXdr = buildXdr({ sequence: '12344' });

      expectBadRequest(
        () => parseAndValidateSignedEnvelope(staleXdr, { expectedSequence: BigInt(sequence) }),
        'stale sequence number',
      );
    });

    it('rejects an envelope whose source does not match the expected account', () => {
      expectBadRequest(
        () =>
          parseAndValidateSignedEnvelope(buildXdr(), { expectedSource: secondSigner.publicKey() }),
        'source does not match the expected account',
      );
    });

    it('accepts an envelope when the pinned sequence and source match', () => {
      const result = parseAndValidateSignedEnvelope(buildXdr(), {
        expectedSequence: sequence,
        expectedSource: signer.publicKey(),
      });

      expect(result.source).toBe(signer.publicKey());
      expect(result.sequence).toBe(sequence);
    });
  });

  describe('signature and XDR failures', () => {
    it('rejects unsigned envelopes and fee bumps with unsigned inner transactions', () => {
      expectBadRequest(
        () => parseAndValidateSignedEnvelope(buildXdr({ sign: false })),
        'at least one signature',
      );
      expectBadRequest(
        () => parseAndValidateSignedEnvelope(buildFeeBumpXdr(false)),
        'at least one signature',
      );
    });

    it('rejects truncated and cryptographically invalid signatures', () => {
      expectBadRequest(
        () => parseAndValidateSignedEnvelope(buildXdr({ truncateSignature: true })),
        'malformed signature',
      );
      expectBadRequest(
        () => parseAndValidateSignedEnvelope(buildXdr({ corruptSignature: true })),
        'valid signature',
      );
    });

    it('rejects malformed and non-transaction XDR with a 400', () => {
      const nonTransactionXdr = xdr.Asset.assetTypeNative().toXDR('base64');
      const truncatedXdr = buildXdr().slice(0, 20);

      expectBadRequest(
        () => parseAndValidateSignedEnvelope('not-base64-xdr!!!'),
        'unable to parse',
      );
      expectBadRequest(() => parseAndValidateSignedEnvelope(''), 'unable to parse');
      expectBadRequest(() => parseAndValidateSignedEnvelope('   '), 'unable to parse');
      expectBadRequest(() => parseAndValidateSignedEnvelope(nonTransactionXdr), 'unable to parse');
      expectBadRequest(() => parseAndValidateSignedEnvelope(truncatedXdr), 'unable to parse');
    });

    it('propagates configuration errors instead of treating them as envelope errors', () => {
      process.env.STELLAR_NETWORK = 'unsupported_network';

      expect(() => parseAndValidateSignedEnvelope(buildXdr())).toThrow(
        /Invalid STELLAR_NETWORK "unsupported_network"/,
      );
    });
  });
});
