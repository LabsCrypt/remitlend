import { query } from '../db/connection.js';
import { AppError } from '../errors/AppError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { notificationService, type NotificationType } from '../services/notificationService.js';
import { encodeCursor, decodeCursor, parseKeysetParams } from '../utils/pagination.js';

/**
 * List all loan disputes for admin review with cursor-based pagination.
 * Defaults to "open" status, orders newest-first by created_at.
 */
export const listLoanDisputes = asyncHandler(async (req, res) => {
  const snapshotSeq = typeof req.query.snapshot_seq === 'string' ? req.query.snapshot_seq : null;
  const cursorStr = typeof req.query.cursor === 'string' ? req.query.cursor : null;
  const limitParam = typeof req.query.limit === 'string' ? req.query.limit : null;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;

  const {
    snapshotSeq: parsedSnapshotSeq,
    cursor: parsedCursor,
    limit,
  } = parseKeysetParams(snapshotSeq, cursorStr, limitParam);

  const statusFilter = status ?? 'open';

  if (
    statusFilter !== 'open' &&
    statusFilter !== 'resolved' &&
    statusFilter !== 'rejected' &&
    statusFilter !== 'all'
  ) {
    throw AppError.badRequest('Invalid status filter');
  }

  // Decode cursor if provided
  let decodedCursor = null;
  if (parsedCursor) {
    decodedCursor = decodeCursor(parsedCursor);
  }

  // Pin snapshot on first request or use provided one
  let actualSnapshotSeq = parsedSnapshotSeq;
  if (actualSnapshotSeq === BigInt(0)) {
    // First page: pin the current max seq
    const maxSeqResult = await query('SELECT MAX(seq) as max_seq FROM loan_disputes', []);
    actualSnapshotSeq = BigInt(maxSeqResult.rows[0]?.max_seq ?? 0);
  }

  const params: unknown[] = [];
  let whereClause = '';

  // Status filter
  if (statusFilter !== 'all') {
    params.push(statusFilter);
    whereClause = `WHERE status = $${params.length}`;
  }

  // Snapshot constraint
  params.push(actualSnapshotSeq.toString());
  const snapshotClause = `seq <= $${params.length}`;
  whereClause += whereClause.includes('WHERE')
    ? ` AND ${snapshotClause}`
    : ` WHERE ${snapshotClause}`;

  // Keyset constraint
  if (decodedCursor) {
    params.push(decodedCursor.createdAt.toISOString());
    params.push(decodedCursor.createdAt.toISOString());
    params.push(decodedCursor.seq.toString());
    const keysetClause = `(created_at < $${params.length - 2} OR (created_at = $${params.length - 1} AND seq < $${params.length}))`;
    whereClause += ` AND ${keysetClause}`;
  }

  params.push(limit + 1);

  const result = await query(
    `SELECT * FROM loan_disputes${whereClause} ORDER BY created_at DESC, seq DESC LIMIT $${params.length}`,
    params,
  );

  const rows = result.rows;
  const hasNext = rows.length > limit;
  const disputes = hasNext ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasNext && disputes.length > 0) {
    const lastDispute = disputes[disputes.length - 1];
    nextCursor = encodeCursor(new Date(lastDispute.created_at), BigInt(lastDispute.seq));
  }

  // Count total at snapshot
  const countParams: unknown[] = [];
  let countWhereClause = '';

  if (statusFilter !== 'all') {
    countParams.push(statusFilter);
    countWhereClause = `WHERE status = $${countParams.length}`;
  }

  countParams.push(actualSnapshotSeq.toString());
  const countSnapshotClause = `seq <= $${countParams.length}`;
  countWhereClause += countWhereClause.includes('WHERE')
    ? ` AND ${countSnapshotClause}`
    : ` WHERE ${countSnapshotClause}`;

  const totalResult = await query(
    `SELECT COUNT(*) as count FROM loan_disputes ${countWhereClause}`,
    countParams,
  );
  const totalAtSnapshot = Number.parseInt(totalResult.rows[0].count, 10);

  res.json({
    success: true,
    data: {
      items: disputes,
    },
    page: {
      next_cursor: nextCursor,
      snapshot_seq: actualSnapshotSeq.toString(),
      total_at_snapshot: totalAtSnapshot,
      limit,
    },
  });
});

/**
 * Get a single dispute with its associated loan
 */
export const getLoanDispute = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const disputeResult = await query(
    `SELECT d.*, l.* AS loan FROM loan_disputes d JOIN loans l ON l.id = d.loan_id WHERE d.id = $1`,
    [disputeId],
  );

  if (disputeResult.rows.length === 0) {
    throw AppError.notFound('Dispute not found');
  }

  res.json({ success: true, dispute: disputeResult.rows[0] });
});

/**
 * Admin resolves a dispute: confirm or reverse default
 * POST /admin/loan-disputes/:disputeId/resolve
 * Body: { action: 'confirm' | 'reverse', resolution: string, adminNote?: string }
 */
export const resolveLoanDispute = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const { action, resolution, adminNote } = req.body as {
    action: string;
    resolution: string;
    adminNote?: string;
  };

  if (!['confirm', 'reverse'].includes(action)) {
    throw AppError.badRequest('Action must be confirm or reverse');
  }
  if (!resolution || resolution.length < 5) {
    throw AppError.badRequest('Resolution reason required');
  }

  // Get dispute and loan
  const disputeResult = await query(
    `SELECT * FROM loan_disputes WHERE id = $1 AND status = 'open'`,
    [disputeId],
  );
  if (disputeResult.rows.length === 0) {
    throw AppError.notFound('Dispute not found or already resolved');
  }
  const dispute = disputeResult.rows[0];

  // Mark dispute as resolved with admin note
  await query(
    `UPDATE loan_disputes SET status = 'resolved', resolution = $1, admin_note = $2, resolved_at = NOW() WHERE id = $3`,
    [resolution, adminNote || null, disputeId],
  );

  if (action === 'confirm') {
    // Leave loan as defaulted, optionally log event
    await query(
      `INSERT INTO contract_events (loan_id, address, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultConfirmed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  } else if (action === 'reverse') {
    // Insert event to mark loan as active again
    await query(
      `INSERT INTO contract_events (loan_id, address, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultReversed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  }

  // Notify borrower via notifications + SSE (and external email if enabled)
  try {
    const msg = `Your dispute for loan ${dispute.loan_id} has been resolved: ${resolution}`;
    const type = action === 'reverse' ? 'repayment_confirmed' : 'loan_defaulted';
    await notificationService.createNotification({
      userId: dispute.borrower,
      type: type as NotificationType,
      title: 'Dispute resolved',
      message: msg,
      loanId: dispute.loan_id,
    });
  } catch {
    // Log and continue — resolution shouldn't fail because of notifications
    // notificationService already logs errors internally
  }

  res.json({ success: true, message: 'Dispute resolved.' });
});

/**
 * Admin rejects a dispute (keeps default status)
 * POST /admin/loan-disputes/:disputeId/reject
 */
export const rejectLoanDispute = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const { admin_note } = req.body as { admin_note?: string };

  const disputeResult = await query(
    `SELECT * FROM loan_disputes WHERE id = $1 AND status = 'open'`,
    [disputeId],
  );
  if (disputeResult.rows.length === 0) {
    throw AppError.notFound('Dispute not found or already processed');
  }

  const dispute = disputeResult.rows[0];

  await query(
    `UPDATE loan_disputes SET status = 'rejected', resolution = $1, resolved_at = NOW() WHERE id = $2`,
    [admin_note ?? 'rejected by admin', disputeId],
  );

  try {
    const msg = `Your dispute for loan ${dispute.loan_id} was rejected by admin.`;
    await notificationService.createNotification({
      userId: dispute.borrower,
      type: 'loan_defaulted' as NotificationType,
      title: 'Dispute rejected',
      message: admin_note ? `${msg} Note: ${admin_note}` : msg,
      loanId: dispute.loan_id,
    });
  } catch {
    // swallow
  }

  res.json({ success: true, message: 'Dispute rejected.' });
});
