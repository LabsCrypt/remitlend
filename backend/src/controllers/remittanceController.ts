import type { Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { query } from '../db/connection.js';
import { remittanceService } from '../services/remittanceService.js';
import { sorobanService } from '../services/sorobanService.js';
import { notificationService } from '../services/notificationService.js';
import { AppError } from '../errors/AppError.js';
import { parseAndValidateSignedEnvelope } from '../utils/stellarEnvelope.js';
import { encodeCursor, decodeCursor, parseKeysetParams } from '../utils/pagination.js';
import logger from '../utils/logger.js';

/**
 * POST /api/remittances - Create a new remittance
 *
 * Creates an unsigned Stellar transaction for the frontend to sign
 * with Freighter wallet. Returns XDR for preview and signing.
 */
export const createRemittance = asyncHandler(async (req: Request, res: Response) => {
  const { recipientAddress, amount, fromCurrency, toCurrency, memo } = req.body;

  // Get sender address from JWT (added by requireJwtAuth middleware)
  const senderAddress = req.user?.publicKey;

  if (!senderAddress) {
    throw AppError.unauthorized('Wallet address not found in request');
  }

  logger.withContext().info('Creating remittance', {
    sender: senderAddress,
    recipient: recipientAddress,
    amount,
    currency: fromCurrency,
  });

  const remittance = await remittanceService.createRemittance({
    recipientAddress,
    amount,
    fromCurrency,
    toCurrency,
    memo,
    senderAddress,
  });

  res.status(201).json({
    success: true,
    data: remittance,
    message: 'Remittance created successfully. Sign the transaction in your wallet.',
  });
});

/**
 * GET /api/remittances - Get user's remittances
 *
 * Returns paginated list of remittances for the authenticated user
 * Supports filtering by status, date range, and search by recipient/reference
 */
export const getRemittances = asyncHandler(async (req: Request, res: Response) => {
  const senderAddress = req.user?.publicKey as string;

  if (!senderAddress) {
    throw AppError.unauthorized('Wallet address not found in request');
  }

  // Parse keyset pagination params
  const snapshotSeq = typeof req.query.snapshot_seq === 'string' ? req.query.snapshot_seq : null;
  const cursorStr = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limitParam = typeof req.query.limit === 'string' ? req.query.limit : null;

  const {
    snapshotSeq: parsedSnapshotSeq,
    cursor: parsedCursor,
    limit,
  } = parseKeysetParams(snapshotSeq, cursorStr, limitParam);

  // Decode cursor if provided
  let decodedCursor = null;
  if (parsedCursor) {
    decodedCursor = decodeCursor(parsedCursor);
  }

  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const q = req.query.q as string | undefined;

  // Build the query
  let whereClause = 'sender_id = $1';
  const params: (string | number | bigint)[] = [senderAddress];

  // Apply filters
  if (status) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }

  if (from) {
    const fromDate = new Date(from);
    if (Number.isNaN(fromDate.getTime())) {
      throw AppError.badRequest("Invalid 'from' date format");
    }
    params.push(fromDate.toISOString());
    whereClause += ` AND created_at >= $${params.length}`;
  }

  if (to) {
    const toDate = new Date(to);
    if (Number.isNaN(toDate.getTime())) {
      throw AppError.badRequest("Invalid 'to' date format");
    }
    params.push(toDate.toISOString());
    whereClause += ` AND created_at <= $${params.length}`;
  }

  if (q) {
    const searchTerm = `%${q}%`;
    params.push(searchTerm, searchTerm);
    whereClause += ` AND (recipient_address ILIKE $${params.length - 1} OR memo ILIKE $${params.length})`;
  }

  // Pin snapshot on first request or use provided one
  let actualSnapshotSeq = parsedSnapshotSeq;
  if (actualSnapshotSeq === BigInt(0)) {
    // First page: pin the current max seq
    const maxSeqResult = await query('SELECT MAX(seq) as max_seq FROM remittances', []);
    actualSnapshotSeq = BigInt(maxSeqResult.rows[0]?.max_seq ?? 0);
  }

  // Add snapshot constraint
  params.push(actualSnapshotSeq.toString());
  whereClause += ` AND seq <= $${params.length}`;

  // Add keyset constraint
  if (decodedCursor) {
    params.push(decodedCursor.createdAt.toISOString());
    params.push(decodedCursor.createdAt.toISOString());
    params.push(decodedCursor.seq.toString());
    const keysetClause = `(created_at < $${params.length - 2} OR (created_at = $${params.length - 1} AND seq < $${params.length}))`;
    whereClause += ` AND ${keysetClause}`;
  }

  params.push(limit + 1);

  const queryText = `
    SELECT * FROM remittances
    WHERE ${whereClause}
    ORDER BY created_at DESC, seq DESC
    LIMIT $${params.length}
  `;

  logger.debug('getRemittances keyset query', {
    queryText,
    queryParams: params,
  });

  const result = await query(queryText, params);

  const hasNext = result.rows.length > limit;
  const remittances = hasNext ? result.rows.slice(0, limit) : result.rows;

  let nextCursor: string | null = null;
  if (hasNext && remittances.length > 0) {
    const lastRemittance = remittances[remittances.length - 1];
    nextCursor = encodeCursor(new Date(lastRemittance.created_at), BigInt(lastRemittance.seq));
  }

  // Count total at snapshot
  const snapshotCountParams = params.slice(0, -2);
  snapshotCountParams.pop(); // remove the seq constraint param
  snapshotCountParams.push(actualSnapshotSeq.toString());

  const totalResult = await query(
    `SELECT COUNT(*) as count FROM remittances WHERE ${whereClause.replace(` AND seq <= $${params.length}`, '')} AND seq <= $${snapshotCountParams.length}`,
    snapshotCountParams,
  );
  const totalAtSnapshot = Number.parseInt(totalResult.rows[0].count, 10);

  res.json({
    success: true,
    data: remittances,
    page: {
      next_cursor: nextCursor,
      snapshot_seq: actualSnapshotSeq.toString(),
      total_at_snapshot: totalAtSnapshot,
      limit,
    },
  });
});

/**
 * GET /api/remittances/:id - Get a single remittance
 *
 * Returns detailed information about a specific remittance
 */
export const getRemittance = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const senderAddress = req.user?.publicKey as string;

  if (!senderAddress) {
    throw AppError.unauthorized('Wallet address not found in request');
  }

  if (!id) {
    throw AppError.badRequest('Remittance ID is required');
  }

  const remittance = await remittanceService.getRemittance(id);

  // Verify the user owns this remittance
  if (remittance.senderId !== senderAddress) {
    throw AppError.forbidden('You do not have access to this remittance');
  }

  res.json({
    success: true,
    data: remittance,
  });
});

/**
 * POST /api/remittances/:id/submit - Submit signed transaction
 *
 * Accepts a signed XDR from Freighter wallet and submits it to Stellar
 */
export const submitRemittanceTransaction = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { signedXdr } = req.body as { signedXdr: string };
  const senderAddress = req.user?.publicKey as string;

  if (!senderAddress) {
    throw AppError.unauthorized('Wallet address not found in request');
  }

  if (!signedXdr) {
    throw AppError.badRequest('Signed XDR is required');
  }

  if (!id) {
    throw AppError.badRequest('Remittance ID is required');
  }

  logger.withContext().info('Submitting remittance transaction', { remittanceId: id });

  try {
    const remittance = await remittanceService.getRemittance(id);

    if (remittance.senderId !== senderAddress) {
      throw AppError.forbidden('You do not have access to this remittance');
    }

    if (remittance.status !== 'pending') {
      throw AppError.badRequest('Remittance has already been submitted');
    }

    // Parse and validate the signed envelope before touching the record. An
    // invalid or unsigned envelope is a client error (400): the record must not
    // be flipped to `processing` or `failed` — the sender can re-sign and retry.
    parseAndValidateSignedEnvelope(signedXdr);

    // Update status to processing before submission
    await remittanceService.updateRemittanceStatus(id, 'processing');

    // Submit signed XDR to Stellar and poll for confirmation
    const stellarResult = await sorobanService.submitSignedTx(signedXdr);

    // Only a confirmed (SUCCESS) submission may transition to `completed`.
    // A rejected / try-again-later result must surface an error and leave the
    // record marked failed — never completed.
    if (stellarResult.status !== 'SUCCESS') {
      const failureMessage = `Transaction was not confirmed by the Stellar network (status: ${stellarResult.status})`;
      logger.withContext().warn('Remittance transaction not confirmed', {
        remittanceId: id,
        txHash: stellarResult.txHash,
        status: stellarResult.status,
      });
      await remittanceService.updateRemittanceStatus(id, 'failed', undefined, failureMessage);
      throw AppError.internal(failureMessage);
    }

    // Persist completed status with transaction hash
    const completed = await remittanceService.updateRemittanceStatus(
      id,
      'completed',
      stellarResult.txHash,
    );

    logger.withContext().info('Remittance transaction confirmed', {
      remittanceId: id,
      txHash: stellarResult.txHash,
      status: stellarResult.status,
    });

    // Notify sender of successful submission
    await notificationService.createNotification({
      userId: senderAddress,
      type: 'repayment_confirmed',
      title: 'Remittance Sent',
      message: `Your remittance of ${remittance.amount} ${remittance.fromCurrency} was submitted successfully. Transaction: ${stellarResult.txHash}`,
      actionUrl: `/remittances/${remittance.id}`,
    });

    res.json({
      success: true,
      data: {
        id,
        status: completed.status,
        txHash: stellarResult.txHash,
        message: 'Transaction confirmed on Stellar network',
      },
    });
  } catch (error) {
    logger.withContext().error('Error submitting remittance transaction:', error);

    // Client-side failures (invalid XDR, not found, not authorized) must not
    // destroy the remittance record — leave it `pending` so the sender can
    // resubmit. Only genuine submission failures mark the record `failed`.
    const isClientError =
      error instanceof AppError && error.statusCode >= 400 && error.statusCode < 500;

    if (id && !isClientError) {
      await remittanceService.updateRemittanceStatus(
        id,
        'failed',
        undefined,
        error instanceof Error ? error.message : 'Unknown error',
      );
    }

    throw error;
  }
});
