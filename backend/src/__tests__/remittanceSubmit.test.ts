import { jest } from '@jest/globals';
import {
  Account,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { Request, Response } from 'express';

// Register module mocks before importing the controller (ESM-safe path).
const mockGetRemittance = jest.fn();
const mockUpdateRemittanceStatus = jest.fn();
const mockSubmitSignedTx = jest.fn();
const mockCreateNotification = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: jest.fn(),
}));

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    createRemittance: jest.fn(),
    getRemittances: jest.fn(),
    getRemittance: mockGetRemittance,
    updateRemittanceStatus: mockUpdateRemittanceStatus,
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: { submitSignedTx: mockSubmitSignedTx },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: { createNotification: mockCreateNotification },
}));

const { submitRemittanceTransaction } = await import('../controllers/remittanceController.js');

const SENDER = Keypair.random().publicKey();
const RECIPIENT = Keypair.random().publicKey();

// Envelope signing keypair. The endpoint validates that the envelope is signed
// (≥1 signature), not that its source matches the authenticated wallet.
const envelopeSigner = Keypair.random();

const buildSignedXdr = (): string => {
  const account = new Account(envelopeSigner.publicKey(), '12345');
  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({ destination: RECIPIENT, asset: Asset.native(), amount: '1' }))
    .setTimeout(30)
    .build();
  tx.sign(envelopeSigner);
  return tx.toXDR();
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeReq(signedXdr: string): Partial<Request> {
  return {
    params: { id: 'remit-1' },
    body: { signedXdr },
    user: { publicKey: SENDER },
  };
}

function makeRes() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  return { status, json } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.STELLAR_NETWORK = 'testnet';
});

afterAll(() => {
  delete process.env.STELLAR_NETWORK;
});

describe('POST /api/remittances/:id/submit', () => {
  it('submits a signed envelope, captures the tx hash and marks the remittance completed', async () => {
    mockGetRemittance.mockResolvedValue({
      id: 'remit-1',
      senderId: SENDER,
      status: 'pending',
      amount: 100,
      fromCurrency: 'USDC',
    });
    mockSubmitSignedTx.mockResolvedValue({ txHash: 'txhash-abc', status: 'SUCCESS' });
    mockUpdateRemittanceStatus.mockImplementation(
      async (id: string, status: string, txHash?: string) => ({
        id,
        status,
        transactionHash: txHash,
      }),
    );

    const req = makeReq(buildSignedXdr()) as Request;
    const res = makeRes();
    const next = jest.fn();

    (submitRemittanceTransaction as (req: Request, res: Response, next: () => void) => void)(
      req,
      res,
      next,
    );
    await flush();

    expect(next).not.toHaveBeenCalled();
    expect(mockSubmitSignedTx).toHaveBeenCalledTimes(1);
    expect(mockUpdateRemittanceStatus).toHaveBeenNthCalledWith(1, 'remit-1', 'processing');
    expect(mockUpdateRemittanceStatus).toHaveBeenNthCalledWith(
      2,
      'remit-1',
      'completed',
      'txhash-abc',
    );
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ status: 'completed', txHash: 'txhash-abc' }),
      }),
    );
  });

  it('marks the remittance failed and surfaces an error when the network rejects the submission', async () => {
    mockGetRemittance.mockResolvedValue({
      id: 'remit-1',
      senderId: SENDER,
      status: 'pending',
      amount: 100,
      fromCurrency: 'USDC',
    });
    mockSubmitSignedTx.mockResolvedValue({ txHash: 'txhash-abc', status: 'ERROR' });

    const req = makeReq(buildSignedXdr()) as Request;
    const res = makeRes();
    const next = jest.fn();

    (submitRemittanceTransaction as (req: Request, res: Response, next: () => void) => void)(
      req,
      res,
      next,
    );
    await flush();

    // Never falsely marked completed.
    expect(mockUpdateRemittanceStatus).not.toHaveBeenCalledWith(
      'remit-1',
      'completed',
      expect.any(String),
    );
    expect(mockUpdateRemittanceStatus).toHaveBeenCalledWith(
      'remit-1',
      'failed',
      undefined,
      expect.stringContaining('not confirmed'),
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });

  it('rejects an invalid signed XDR with a 400 without touching the record or calling the RPC', async () => {
    mockGetRemittance.mockResolvedValue({
      id: 'remit-1',
      senderId: SENDER,
      status: 'pending',
      amount: 100,
      fromCurrency: 'USDC',
    });

    const req = makeReq('not-a-valid-xdr!!!') as Request;
    const res = makeRes();
    const next = jest.fn();

    (submitRemittanceTransaction as (req: Request, res: Response, next: () => void) => void)(
      req,
      res,
      next,
    );
    await flush();

    // Envelope validation happens before submission and before any status write.
    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
    expect(mockUpdateRemittanceStatus).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });
});
