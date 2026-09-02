import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import { AppError } from '../../errors/AppError.js';
import { parseAndValidateSignedEnvelope } from '../stellarEnvelope.js';

describe('parseAndValidateSignedEnvelope', () => {
  const signer = Keypair.random();
  const destination = Keypair.random().publicKey();

  const buildXdr = (sign: boolean): string => {
    const account = new Account(signer.publicKey(), '12345');
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: '1' }))
      .setTimeout(30)
      .build();

    if (sign) {
      tx.sign(signer);
    }

    return tx.toXDR();
  };

  beforeAll(() => {
    process.env.STELLAR_NETWORK = 'testnet';
  });

  afterAll(() => {
    delete process.env.STELLAR_NETWORK;
  });

  it('accepts a signed envelope and returns its source and signature count', () => {
    const result = parseAndValidateSignedEnvelope(buildXdr(true));

    expect(result.signatureCount).toBe(1);
    expect(result.source).toBe(signer.publicKey());
  });

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

  it('rejects malformed XDR with a 400', () => {
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
});
