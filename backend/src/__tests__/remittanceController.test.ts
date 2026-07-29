import { jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';
import type { Remittance } from '../services/remittanceService.js';

const mockGetRemittance = jest.fn<(id: string) => Promise<Remittance>>();
const mockUpdateRemittanceStatus = jest.fn();
const mockSubmitSignedTx = jest.fn();

jest.unstable_mockModule('../services/remittanceService.js', () => ({
  remittanceService: {
    getRemittance: mockGetRemittance,
    updateRemittanceStatus: mockUpdateRemittanceStatus,
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    submitSignedTx: mockSubmitSignedTx,
  },
}));

jest.unstable_mockModule('../services/notificationService.js', () => ({
  notificationService: {
    createNotification: jest.fn(),
  },
}));

const { getRemittance, submitRemittanceTransaction } =
  await import('../controllers/remittanceController.js');
const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res) as unknown as Response['status'];
  res.json = jest.fn().mockReturnValue(res) as unknown as Response['json'];
  return res;
};

describe('remittanceController.getRemittance', () => {
  const SENDER = 'GBTESTSENDER1234567890123456789012345678901234567890123';
  const RECIPIENT = 'GBTESTRECIPIENT1234567890123456789012345678901234567890';
  const OTHER_USER = 'GBTESTOTHERUSER12345678901234567890123456789012345678';

  const mockRemittance: Remittance = {
    id: 'remit-123',
    senderId: SENDER,
    recipientAddress: RECIPIENT,
    amount: 100,
    fromCurrency: 'USDC',
    toCurrency: 'USDC',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows sender to read their remittance', async () => {
    mockGetRemittance.mockResolvedValue(mockRemittance);

    const req = {
      params: { id: 'remit-123' },
      user: { publicKey: SENDER },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    getRemittance(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetRemittance).toHaveBeenCalledWith('remit-123');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockRemittance,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('allows recipient to read the remittance', async () => {
    mockGetRemittance.mockResolvedValue(mockRemittance);

    const req = {
      params: { id: 'remit-123' },
      user: { publicKey: RECIPIENT },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    getRemittance(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetRemittance).toHaveBeenCalledWith('remit-123');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: mockRemittance,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('denies access to an unauthorized third party (IDOR prevention)', async () => {
    mockGetRemittance.mockResolvedValue(mockRemittance);

    const req = {
      params: { id: 'remit-123' },
      user: { publicKey: OTHER_USER },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    getRemittance(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetRemittance).toHaveBeenCalledWith('remit-123');
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'You do not have access to this remittance',
      }),
    );
    expect(res.json).not.toHaveBeenCalled();
  });

  it('throws unauthorized if user is not authenticated', async () => {
    const req = {
      params: { id: 'remit-123' },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    getRemittance(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        message: 'Wallet address not found in request',
      }),
    );
  });
});

describe('remittanceController.submitRemittanceTransaction', () => {
  const SENDER = 'GBTESTSENDER1234567890123456789012345678901234567890123';
  const OTHER_USER = 'GBTESTOTHERUSER12345678901234567890123456789012345678';

  const mockRemittance: Remittance = {
    id: 'remit-123',
    senderId: SENDER,
    recipientAddress: 'GBTESTRECIPIENT1234567890123456789012345678901234567890',
    amount: 100,
    fromCurrency: 'USDC',
    toCurrency: 'USDC',
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('denies transaction submission from non-sender', async () => {
    mockGetRemittance.mockResolvedValue(mockRemittance);

    const req = {
      params: { id: 'remit-123' },
      body: { signedXdr: 'mock-signed-xdr' },
      user: { publicKey: OTHER_USER },
    } as unknown as Request;
    const res = createMockResponse();
    const next = jest.fn();

    submitRemittanceTransaction(req, res, next as unknown as NextFunction);
    await flushAsync();

    expect(mockGetRemittance).toHaveBeenCalledWith('remit-123');
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'You do not have access to this remittance',
      }),
    );
  });
});
