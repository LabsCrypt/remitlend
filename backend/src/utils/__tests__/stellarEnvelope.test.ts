import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { AppError } from '../../errors/AppError.js';
import { parseAndValidateSignedEnvelope } from '../stellarEnvelope.js';

describe('parseAndValidateSignedEnvelope', () => {
  const signer = Keypair.random();
  const secondSigner = Keypair.random();
  const destination = Keypair.random().publicKey();

  const buildXdr = (
    sign: boolean,
    options: {
      sequence?: string;
      networkPassphrase?: string;
      additionalSigners?: Keypair[];
    } = {},
  ): string => {
    const sequence = options.sequence ?? '12345';
    const networkPassphrase = options.networkPassphrase ?? Networks.TESTNET;
    const account = new Account(signer.publicKey(), sequence);

    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();

    if (sign) {
      tx.sign(signer);
      if (options.additionalSigners) {
        for (const s of options.additionalSigners) {
          tx.sign(s);
        }
      }
    }

    return tx.toXDR();
  };

  const buildFeeBumpXdr = (signInner: boolean): string => {
    const account = new Account(signer.publicKey(), '12345');
    const innerTx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();

    if (signInner) {
      innerTx.sign(signer);
    }

    const feeSource = Keypair.random();
    const feeBumpTx = TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      '200',
      innerTx,
      Networks.TESTNET,
    );
    feeBumpTx.sign(feeSource);
    return feeBumpTx.toXDR();
  };

  beforeEach(() => {
    process.env.STELLAR_NETWORK = 'testnet';
  });

  afterAll(() => {
    delete process.env.STELLAR_NETWORK;
  });

  describe('valid transactions', () => {
    it('accepts a signed envelope and returns its source and signature count', () => {
      const result = parseAndValidateSignedEnvelope(buildXdr(true));

      expect(result.signatureCount).toBe(1);
      expect(result.source).toBe(signer.publicKey());
    });

    it('accepts a multi-signed envelope with multiple valid signatures', () => {
      const result = parseAndValidateSignedEnvelope(
        buildXdr(true, { additionalSigners: [secondSigner] }),
      );

      expect(result.signatureCount).toBe(2);
      expect(result.source).toBe(signer.publicKey());
    });

    it('accepts a signed FeeBumpTransaction and returns the inner source and signature count', () => {
      const result = parseAndValidateSignedEnvelope(buildFeeBumpXdr(true));

      expect(result.signatureCount).toBe(1);
      expect(result.source).toBe(signer.publicKey());
    });

    it('accepts envelopes with various sequence number boundaries', () => {
      const zeroSeqResult = parseAndValidateSignedEnvelope(buildXdr(true, { sequence: '0' }));
      expect(zeroSeqResult.signatureCount).toBe(1);

      const highSeqResult = parseAndValidateSignedEnvelope(
        buildXdr(true, { sequence: '9223372036854775807' }),
      );
      expect(highSeqResult.signatureCount).toBe(1);
    });

    it('parses valid envelopes when configured for mainnet network', () => {
      process.env.STELLAR_NETWORK = 'mainnet';
      const mainnetXdr = buildXdr(true, { networkPassphrase: Networks.PUBLIC });

      const result = parseAndValidateSignedEnvelope(mainnetXdr);
      expect(result.signatureCount).toBe(1);
      expect(result.source).toBe(signer.publicKey());
    });
  });

  describe('error handling and edge cases', () => {
    it('rejects a well-formed but unsigned envelope with a 400', () => {
      let error: unknown;

      try {
        parseAndValidateSignedEnvelope(buildXdr(false));
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).message).toContain('at least one signature');
    });

    it('rejects a FeeBumpTransaction whose inner transaction is unsigned with a 400', () => {
      let error: unknown;

      try {
        parseAndValidateSignedEnvelope(buildFeeBumpXdr(false));
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).message).toContain('at least one signature');
    });

    it('rejects non-base64 malformed string with a 400', () => {
      let error: unknown;

      try {
        parseAndValidateSignedEnvelope('not-base64-xdr!!!');
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).message).toContain('unable to parse');
    });

    it('rejects empty and whitespace-only strings with a 400', () => {
      expect(() => parseAndValidateSignedEnvelope('')).toThrow(AppError);
      expect(() => parseAndValidateSignedEnvelope('   ')).toThrow(AppError);
    });

    it('rejects valid XDR that is not a transaction envelope with a 400', () => {
      const nonTxXdr = xdr.Asset.assetTypeNative().toXDR('base64');
      let error: unknown;

      try {
        parseAndValidateSignedEnvelope(nonTxXdr);
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).message).toContain('unable to parse');
    });

    it('rejects truncated valid transaction envelope XDR with a 400', () => {
      const fullXdr = buildXdr(true);
      const truncatedXdr = fullXdr.slice(0, 20);
      let error: unknown;

      try {
        parseAndValidateSignedEnvelope(truncatedXdr);
      } catch (err) {
        error = err;
      }

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
      expect((error as AppError).message).toContain('unable to parse');
    });

    it('propagates configuration error if STELLAR_NETWORK is invalid', () => {
      process.env.STELLAR_NETWORK = 'unsupported_network';

      expect(() => parseAndValidateSignedEnvelope(buildXdr(true))).toThrow(
        /Invalid STELLAR_NETWORK "unsupported_network"/,
      );
    });
  });
});
