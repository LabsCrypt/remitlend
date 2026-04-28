import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { notificationService } from "../services/notificationService.js";

/**
 * List all open loan disputes for admin review
 */
export const listLoanDisputes = asyncHandler(async (req, res) => {
  const status = (req.query.status as string | undefined) ?? "open";
  if (!["open", "resolved", "rejected", "all"].includes(status)) {
    throw AppError.badRequest("Invalid status filter");
  }

  const where = status === "all" ? "" : `WHERE status = '${status}'`;
  const result = await query(
    `SELECT * FROM loan_disputes ${where} ORDER BY created_at ASC`,
    [],
  );
  res.json({ success: true, disputes: result.rows });
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
    throw AppError.notFound("Dispute not found");
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

  if (!["confirm", "reverse"].includes(action)) {
    throw AppError.badRequest("Action must be confirm or reverse");
  }
  if (!resolution || resolution.length < 5) {
    throw AppError.badRequest("Resolution reason required");
  }

  // Get dispute and loan
  const disputeResult = await query(
    `SELECT * FROM loan_disputes WHERE id = $1 AND status = 'open'`,
    [disputeId],
  );
  if (disputeResult.rows.length === 0) {
    throw AppError.notFound("Dispute not found or already resolved");
  }
  const dispute = disputeResult.rows[0];

  // Mark dispute as resolved with admin note
  await query(
    `UPDATE loan_disputes SET status = 'resolved', resolution = $1, admin_note = $2, resolved_at = NOW() WHERE id = $3`,
    [resolution, adminNote || null, disputeId],
  );

  if (action === "confirm") {
    // Leave loan as defaulted, optionally log event
    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultConfirmed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  } else if (action === "reverse") {
    // Insert event to mark loan as active again
    await query(
      `INSERT INTO loan_events (loan_id, borrower, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultReversed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  }

  // Notify borrower via notifications + SSE (and external email if enabled)
  try {
    const msg = `Your dispute for loan ${dispute.loan_id} has been resolved: ${resolution}`;
    const type =
      action === "reverse" ? "repayment_confirmed" : "loan_defaulted";
    await notificationService.createNotification({
      userId: dispute.borrower,
      type: type as any,
      title: "Dispute resolved",
      message: msg,
      loanId: dispute.loan_id,
    });
  } catch (_err) {
    // Log and continue — resolution shouldn't fail because of notifications
    // notificationService already logs errors internally
  }

  res.json({ success: true, message: "Dispute resolved." });
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
    throw AppError.notFound("Dispute not found or already processed");
  }

  const dispute = disputeResult.rows[0];

  await query(
    `UPDATE loan_disputes SET status = 'rejected', resolution = $1, resolved_at = NOW() WHERE id = $2`,
    [admin_note ?? "rejected by admin", disputeId],
  );

  try {
    const msg = `Your dispute for loan ${dispute.loan_id} was rejected by admin.`;
    await notificationService.createNotification({
      userId: dispute.borrower,
      type: "loan_defaulted" as any,
      title: "Dispute rejected",
      message: admin_note ? `${msg} Note: ${admin_note}` : msg,
      loanId: dispute.loan_id,
    });
  } catch (_err) {
    // swallow
  }

  res.json({ success: true, message: "Dispute rejected." });
});
