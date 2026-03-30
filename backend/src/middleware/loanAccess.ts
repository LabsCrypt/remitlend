import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { ErrorCode } from "../errors/errorCodes.js";
import { asyncHandler } from "./asyncHandler.js";

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

    if (!pk) {
      throw AppError.unauthorized("Authentication required");
    }
    if (!loanId) {
      throw AppError.badRequest("Loan ID is required");
    }

    const r = await query(
      `SELECT borrower FROM loan_events WHERE loan_id = $1 LIMIT 1`,
      [loanId],
    );

    const row = r.rows[0] as { borrower: string } | undefined;
    if (!row) {
      throw AppError.notFound("Loan not found");
    }
    if (row.borrower !== pk) {
      throw AppError.forbidden(
        "You are not authorized to access this loan",
        ErrorCode.ACCESS_DENIED,
      );
    }

    next();
  },
);
