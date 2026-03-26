import { query } from "../db/connection.js";
import { AppError } from "../errors/AppError.js";
import { asyncHandler } from "./asyncHandler.js";

/**
 * After `requireJwtAuth`, ensures `req.params.loanId` refers to a loan whose
 * borrower matches the JWT `publicKey`. Returns 404 when the loan is missing
 * or the caller is not the borrower (avoid loan-id enumeration).
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
    if (!row || row.borrower !== pk) {
      throw AppError.notFound("Loan not found");
    }

    next();
  },
);
