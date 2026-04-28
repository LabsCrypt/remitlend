import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { notificationService } from "../services/notificationService.js";

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
      `INSERT INTO contract_events (loan_id, address, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultConfirmed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  } else if (action === "reverse") {
    // Insert event to mark loan as active again
    await query(
      `INSERT INTO contract_events (loan_id, address, event_type, amount, ledger, ledger_closed_at) VALUES ($1, $2, 'DefaultReversed', NULL, NULL, NOW())`,
      [dispute.loan_id, dispute.borrower],
    );
  }

  // Notify borrower about dispute resolution
  try {
    const notificationTitle =
      action === "confirm"
        ? "Dispute Resolved: Default Confirmed"
        : "Dispute Resolved: Default Reversed";

    const notificationMessage =
      action === "confirm"
        ? `Your loan dispute (Loan #${dispute.loan_id}) has been reviewed and the default status has been confirmed. Admin note: ${adminNote || resolution}`
        : `Your loan dispute (Loan #${dispute.loan_id}) has been reviewed and the default status has been reversed. Your loan is now active. Admin note: ${adminNote || resolution}`;

    await notificationService.createNotification({
      userId: dispute.borrower,
      type: action === "confirm" ? "loan_defaulted" : "repayment_confirmed",
      title: notificationTitle,
      message: notificationMessage,
      loanId: dispute.loan_id,
    });
  } catch (error) {
    // Log error but don't fail the entire resolution
    console.error("Failed to send dispute resolution notification:", error);
  }

  res.json({ success: true, message: "Dispute resolved and borrower notified." });
});
