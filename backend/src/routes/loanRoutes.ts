import { createTestLoan } from "../controllers/loanController.js";
import { markLoanDefaulted } from "../controllers/loanController.js";
import { contestDefault } from "../controllers/loanController.js";
import { Router } from "express";
import {
  getLoanConfigEndpoint,
  getBorrowerLoans,
  getLoanDetails,
  getLoanAmortizationSchedule,
  previewLoanAmortizationSchedule,
  requestLoan,
  repayLoan,
  submitTransaction,
} from "../controllers/loanController.js";
import {
  requireJwtAuth,
  requireScopes,
  requireWalletOwnership,
} from "../middleware/jwtAuth.js";
import { requireLoanBorrowerAccess } from "../middleware/loanAccess.js";
import {
  validate,
  validateBody,
  validateParams,
} from "../middleware/validation.js";
import { idempotencyMiddleware } from "../middleware/idempotency.js";
import { borrowerParamSchema } from "../schemas/stellarSchemas.js";
import {
  previewAmortizationSchema,
  requestLoanSchema,
  repayLoanSchema,
  repayLoanParamsSchema,
  submitTxSchema,
} from "../schemas/loanSchemas.js";





const router = Router();

// TEST/DEV ONLY: Create a loan directly for test setup
if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
  router.post("/", requireJwtAuth, createTestLoan);
}

// TEST/DEV ONLY: Mark a loan as defaulted for test setup
if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
  router.post(
    "/:loanId/mark-defaulted",
    requireJwtAuth,
    requireLoanBorrowerAccess,
    markLoanDefaulted,
  );
}

// TEST/DEV ONLY: Mark a loan as defaulted for test setup
if (process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development") {
  router.post(
    "/:loanId/mark-defaulted",
    requireJwtAuth,
    requireLoanBorrowerAccess,
    markLoanDefaulted,
  );
}


router.get("/config", getLoanConfigEndpoint);

router.post(
  "/amortization-preview",
  requireJwtAuth,
  validateBody(previewAmortizationSchema),
  previewLoanAmortizationSchedule,
);

/**
 * @swagger
 * /loans/{loanId}/contest-default:
 *   post:
 *     summary: Contest a defaulted loan
 *     description: >
 *       Allows a borrower to contest a defaulted loan, moving it to disputed status and logging the dispute.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for contesting the default
 *     responses:
 *       200:
 *         description: Dispute submitted successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan exists but belongs to a different borrower
 *       404:
 *         description: Loan not found
 */
router.post(
  "/:loanId/contest-default",
  requireJwtAuth,
  requireLoanBorrowerAccess,
  contestDefault,
);

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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BorrowerLoansResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: borrower does not match authenticated wallet
 */
router.get(
  "/borrower/:borrower",
  requireJwtAuth,
  requireScopes("read:loans"),
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
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoanDetailsResponse'
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan exists but belongs to a different borrower
 *       404:
 *         description: Loan not found
 */
router.get(
  "/:loanId",
  requireJwtAuth,
  requireScopes("read:loans"),
  requireLoanBorrowerAccess,
  getLoanDetails,
);

router.get(
  "/:loanId/amortization-schedule",
  requireJwtAuth,
  requireScopes("read:loans"),
  requireLoanBorrowerAccess,
  getLoanAmortizationSchedule,
);

/**
 * @swagger
 * /loans/request:
 *   post:
 *     summary: Build an unsigned loan request transaction
 *     description: >
 *       Builds an unsigned Soroban `request_loan(borrower, amount)` transaction XDR.
 *       The frontend signs it with the user's wallet and submits via POST /api/loans/submit.
 *     tags: [Loans]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - borrowerPublicKey
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Loan amount requested
 *                 example: 1000
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key (must match JWT)
 *     responses:
 *       200:
 *         description: Unsigned transaction XDR returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UnsignedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/request",
  requireJwtAuth,
  validateBody(requestLoanSchema),
  idempotencyMiddleware,
  requestLoan,
);

/**
 * @swagger
 * /loans/submit:
 *   post:
 *     summary: Submit a signed loan request transaction
 *     description: >
 *       Submits a signed transaction XDR to the Stellar network for a loan request.
 *     tags: [Loans]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedTxXdr
 *             properties:
 *               signedTxXdr:
 *                 type: string
 *                 description: Signed transaction XDR
 *     responses:
 *       200:
 *         description: Transaction submitted and result returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmittedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.post(
  "/submit",
  requireJwtAuth,
  validateBody(submitTxSchema),
  idempotencyMiddleware,
  submitTransaction,
);

/**
 * @swagger
 * /loans/{loanId}/repay:
 *   post:
 *     summary: Build an unsigned repayment transaction
 *     description: >
 *       Builds an unsigned Soroban `repay(borrower, loan_id, amount)` transaction XDR.
 *       The frontend signs it with the user's wallet and submits via
 *       POST /api/loans/{loanId}/submit.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amount
 *               - borrowerPublicKey
 *             properties:
 *               amount:
 *                 type: number
 *                 description: Repayment amount
 *                 example: 500
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key (must match JWT)
 *     responses:
 *       200:
 *         description: Unsigned repayment transaction XDR returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RepayTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan exists but belongs to a different borrower
 *       404:
 *         description: Loan not found
 */
router.post(
  "/:loanId/repay",
  requireJwtAuth,
  requireLoanBorrowerAccess,
  validateParams(repayLoanParamsSchema),
  validateBody(repayLoanSchema),
  idempotencyMiddleware,
  repayLoan,
);

/**
 * @swagger
 * /loans/{loanId}/submit:
 *   post:
 *     summary: Submit a signed repayment transaction
 *     description: >
 *       Submits a signed transaction XDR to the Stellar network for a loan repayment.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - signedTxXdr
 *             properties:
 *               signedTxXdr:
 *                 type: string
 *                 description: Signed transaction XDR
 *     responses:
 *       200:
 *         description: Transaction submitted and result returned
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SubmittedTransactionResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan exists but belongs to a different borrower
 *       404:
 *         description: Loan not found
 */
router.post(
  "/:loanId/submit",
  requireJwtAuth,
  requireLoanBorrowerAccess,
  validateParams(repayLoanParamsSchema),
  validateBody(submitTxSchema),
  idempotencyMiddleware,
  submitTransaction,
);

export default router;
