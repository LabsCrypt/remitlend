import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * List all open loan disputes for admin review
 */
export const listLoanDisputes = asyncHandler(async (_req, res) => {
  const result = await query(
    `SELECT * FROM loan_disputes WHERE status = 'open' ORDER BY created_at ASC`,
    [],
  );
  res.json({ success: true, disputes: result.rows });
});

/**
 * Admin resolves a dispute: confirm or reverse default
 * POST /admin/loan-disputes/:disputeId/resolve
 * Body: { action: 'confirm' | 'reverse', resolution: string }
 */
export const resolveLoanDispute = asyncHandler(async (req, res) => {
  const { disputeId } = req.params;
  const { action, resolution } = req.body as { action: string; resolution: string };

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

  // Mark dispute as resolved
  await query(
    `UPDATE loan_disputes SET status = 'resolved', resolution = $1, resolved_at = NOW() WHERE id = $2`,
    [resolution, disputeId],
  );

  if (action === 'confirm') {
    // Leave loan as defaulted, optionally log event
    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultConfirmed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  } else if (action === 'reverse') {
    // Insert event to mark loan as active again
    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultReversed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  }

  res.json({ success: true, message: 'Dispute resolved.' });
});
