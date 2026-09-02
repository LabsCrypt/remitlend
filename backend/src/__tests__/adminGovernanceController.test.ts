import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response } from 'express';

type MockQueryResult = { rows: Record<string, unknown>[]; rowCount: number };

const mockQuery: jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  query: mockQuery,
  getClient: jest.fn(),
  withTransaction: jest.fn(),
  closePool: jest.fn(),
}));

const { getPendingGovernance } = await import('../controllers/adminGovernanceController.js');

const flushAsync = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const createMockResponse = (): Response =>
  ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  }) as unknown as Response;

describe('adminGovernanceController - getPendingGovernance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOVERNANCE_CURRENT_ADMIN = 'GADMIN_CURRENT';
    process.env.MULTISIG_GOVERNANCE_CONTRACT_ID = 'CCONTRACT_123';
    process.env.GOVERNANCE_THRESHOLD = '2';
  });

  afterEach(() => {
    delete process.env.GOVERNANCE_CURRENT_ADMIN;
    delete process.env.MULTISIG_GOVERNANCE_CONTRACT_ID;
    delete process.env.GOVERNANCE_THRESHOLD;
  });

  it('filters signers so signers from older pending proposals are not mixed in', async () => {
    const req = {} as Request;
    const res = createMockResponse();

    // Database returns rows from multiple proposals (ordered by proposal_id DESC)
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          proposal_id: 'prop-2',
          proposed_admin: 'GNEW_ADMIN_2',
          approval_count: 1,
          threshold: 2,
          executable_at: '2026-09-01T00:00:00Z',
          expires_at: '2026-09-05T00:00:00Z',
          signer_address: 'GSIGNER_PROP2_APPROVED',
          approved: true,
        },
        {
          proposal_id: 'prop-2',
          proposed_admin: 'GNEW_ADMIN_2',
          approval_count: 1,
          threshold: 2,
          executable_at: '2026-09-01T00:00:00Z',
          expires_at: '2026-09-05T00:00:00Z',
          signer_address: 'GSIGNER_PROP2_PENDING',
          approved: false,
        },
        {
          proposal_id: 'prop-1', // Older proposal
          proposed_admin: 'GOLD_ADMIN_1',
          approval_count: 2,
          threshold: 2,
          executable_at: null,
          expires_at: null,
          signer_address: 'GSIGNER_PROP1_ONLY',
          approved: true,
        },
      ],
      rowCount: 3,
    });

    getPendingGovernance(req, res, () => {});
    await flushAsync();

    expect(res.json).toHaveBeenCalledTimes(1);
    const responseData = (res.json as jest.Mock).mock.calls[0]?.[0] as Record<string, any>;

    expect(responseData.pendingProposal).toBeDefined();
    expect(responseData.pendingProposal.id).toBe('prop-2');
    expect(responseData.pendingProposal.proposedAdmin).toBe('GNEW_ADMIN_2');

    // Crucial check: only prop-2 signers should be included, NOT prop-1 signer
    const signers = responseData.pendingProposal.signers;
    expect(signers).toHaveLength(2);
    expect(signers).toEqual([
      { address: 'GSIGNER_PROP2_APPROVED', approved: true },
      { address: 'GSIGNER_PROP2_PENDING', approved: false },
    ]);
    expect(signers.some((s: { address: string }) => s.address === 'GSIGNER_PROP1_ONLY')).toBe(
      false,
    );
  });

  it('returns fallback signers from env when no pending proposal exists', async () => {
    process.env.GOVERNANCE_SIGNERS = 'GSIGNER_1, GSIGNER_2';
    const req = {} as Request;
    const res = createMockResponse();

    mockQuery.mockResolvedValueOnce({
      rows: [],
      rowCount: 0,
    });

    getPendingGovernance(req, res, () => {});
    await flushAsync();

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingProposal: null,
        signers: [
          { address: 'GSIGNER_1', approved: false },
          { address: 'GSIGNER_2', approved: false },
        ],
        threshold: 2,
      }),
    );
  });
});
