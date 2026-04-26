import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { asyncHandler } from "../utils/asyncHandler.js";

/**
 * After `requireJwtAuth`, ensures `req.params.loanId` refers to a loan whose
 * borrower matches the JWT `publicKey`.
 * Returns 404 when the loan is missing and 403 when it belongs to a different
 * borrower.
 */
export const requireLoanBorrowerAccess = asyncHandler(
  async (req, res, next) => {
    const loanId = req.params.loanId;
    const pk = req.user?.publicKey;
    const role = req.user?.role;

    if (!pk) {
      throw AppError.unauthorized("Authentication required");
    }
    if (!loanId) {
      throw AppError.badRequest("Loan ID is required");
    }

    // Admins and lenders are allowed to view loan details.
    if (role === "admin" || role === "lender") {
      return next();
    }

    const r = await query(
      `SELECT address FROM contract_events WHERE loan_id = $1 LIMIT 1`,
      [loanId],
    );

    const row = r.rows[0] as { address: string } | undefined;
    if (!row) {
      throw AppError.notFound("Loan not found");
    }
    if (row.address !== pk) {
      throw AppError.forbidden(
        "You are not authorized to access this loan",
        ErrorCode.ACCESS_DENIED,
      );
    }

    next();
  },
);

/**
 * After `requireJwtAuth`, ensures `req.params.loanId` refers to a loan whose
 * borrower matches the JWT `publicKey`.
 *
 * Unlike `requireLoanBorrowerAccess`, this is intended for state-mutating
 * borrower actions and does not allow role-based bypass.
 */
export const requireLoanOwnership = asyncHandler(async (req, res, next) => {
  const loanId = req.params.loanId;
  const pk = req.user?.publicKey;

  if (!pk) {
    throw AppError.unauthorized("Authentication required");
  }
  if (!loanId) {
    throw AppError.badRequest("Loan ID is required");
  }

  const r = await query(
    `SELECT address FROM contract_events WHERE loan_id = $1 LIMIT 1`,
    [loanId],
  );

  const row = r.rows[0] as { address: string } | undefined;
  if (!row) {
    throw AppError.notFound("Loan not found");
  }
  if (row.address !== pk) {
    throw AppError.forbidden(
      "You are not authorized to access this loan",
      ErrorCode.ACCESS_DENIED,
    );
  }

  next();
});
