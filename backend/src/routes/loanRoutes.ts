import { Router } from "express";
import {
  getBorrowerLoans,
  getLoanDetails,
} from "../controllers/loanController.js";
import {
  requireJwtAuth,
  requireWalletOwnership,
} from "../middleware/jwtAuth.js";
import { requireLoanBorrowerAccess } from "../middleware/loanAccess.js";
import { validate } from "../middleware/validation.js";
import { borrowerParamSchema } from "../schemas/stellarSchemas.js";

const router = Router();

/**
 * @swagger
 * /loans/borrower/{borrower}:
 *   get:
 *     summary: Get loans for a specific borrower
 *     description: >
 *       Returns loans for the authenticated wallet only; `borrower` must match
 *       the JWT Stellar public key.
 *     tags: [Loans]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: borrower
 *         required: true
 *         schema:
 *           type: string
 *         description: Borrower's Stellar address (must match JWT)
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, repaid, all]
 *           default: active
 *     responses:
 *       200:
 *         description: Loans retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: borrower does not match authenticated wallet
 */
router.get(
  "/borrower/:borrower",
  requireJwtAuth,
  requireWalletOwnership,
  validate(borrowerParamSchema),
  getBorrowerLoans,
);

/**
 * @swagger
 * /loans/{loanId}:
 *   get:
 *     summary: Get loan details
 *     description: >
 *       Returns loan details only if the authenticated wallet is the borrower
 *       for that loan.
 *     tags: [Loans]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID
 *     responses:
 *       200:
 *         description: Loan details retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 *       404:
 *         description: Loan not found or not accessible
 */
router.get(
  "/:loanId",
  requireJwtAuth,
  requireLoanBorrowerAccess,
  getLoanDetails,
);

export default router;
