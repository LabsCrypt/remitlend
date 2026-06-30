import { createTestLoan } from '../controllers/loanController.js';
import { markLoanDefaulted } from '../controllers/loanController.js';
import { contestDefault } from '../controllers/loanController.js';
import { Router } from 'express';
import {
  getLoanConfigEndpoint,
  getBorrowerLoans,
  getLoanDetails,
  getLoanAmortizationSchedule,
  previewLoanAmortizationSchedule,
  requestLoan,
  repayLoan,
  depositCollateral,
  releaseCollateral,
  refinanceLoan,
  extendLoan,
  buildLiquidateLoan,
  submitTransaction,
} from '../controllers/loanController.js';
import { getLoanEvents } from '../controllers/indexerController.js';
import { requireJwtAuth, requireScopes, requireWalletOwnership } from '../middleware/jwtAuth.js';
import { requireLoanBorrowerAccess, requireLoanOwner } from '../middleware/loanAccess.js';
import { validate, validateBody, validateParams, validateQuery } from '../middleware/validation.js';
import { idempotencyMiddleware } from '../middleware/idempotency.js';
import { borrowerParamSchema } from '../schemas/stellarSchemas.js';
import {
  previewAmortizationSchema,
  requestLoanSchema,
  repayLoanSchema,
  repayLoanParamsSchema,
  submitTxSchema,
  depositCollateralSchema,
  releaseCollateralSchema,
  refinanceLoanSchema,
  extendLoanSchema,
  liquidateLoanSchema,
  borrowerLoansQuerySchema,
} from '../schemas/loanSchemas.js';

import { buildCancelLoanTx } from '../controllers/loanController.js';

const router = Router();

// TEST/DEV ONLY: Create a loan directly for test setup
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  router.post('/', requireJwtAuth, createTestLoan);
}

// TEST/DEV ONLY: Mark a loan as defaulted for test setup
if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
  router.post('/:loanId/mark-defaulted', requireJwtAuth, requireLoanOwner, markLoanDefaulted);
}

router.get('/config', getLoanConfigEndpoint);

/**
 * @swagger
 * /loans/{loanId}/build-cancel:
 *   post:
 *     summary: Build cancel loan transaction
 *     tags:
 *       - Loans
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction built successfully
 */

/**
 * @swagger
 * /admin/loans/{loanId}/build-reject:
 *   post:
 *     summary: Build reject loan transaction
 *     tags:
 *       - Admin Loans
 *     security:
 *       - bearerAuth: []
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
 *                 minLength: 5
 *                 maxLength: 500
 *     responses:
 *       200:
 *         description: Reject transaction built
 */

router.post('/:loanId/build-cancel', requireJwtAuth, requireLoanOwner, buildCancelLoanTx);

router.post(
  '/amortization-preview',
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
router.post('/:loanId/contest-default', requireJwtAuth, requireLoanOwner, contestDefault);

/**
 * @swagger
 * /loans/borrower/{borrower}:
 *   get:
 *     summary: Get loans for a specific borrower
 *     description: >
 *       Returns cursor-paginated loans for the authenticated wallet.
 *       `borrower` must match the JWT Stellar public key.
 *       Supports filtering by `status` and an approved-at date range (`from` / `to`).
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
 *           enum: [active, repaid, defaulted, liquidated, pending, all]
 *         description: Filter by loan status (omit or "all" to return every status)
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO-8601 start of approved_at date range (inclusive)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: ISO-8601 end of approved_at date range (inclusive)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Number of results per page
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Opaque cursor from the previous response for pagination
 *     responses:
 *       200:
 *         description: Loans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BorrowerLoansResponse'
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: borrower does not match authenticated wallet
 */
router.get(
  '/borrower/:borrower',
  requireJwtAuth,
  requireScopes('read:loans'),
  requireWalletOwnership,
  validate(borrowerParamSchema),
  validateQuery(borrowerLoansQuerySchema),
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
  '/:loanId',
  requireJwtAuth,
  requireScopes('read:loans'),
  requireLoanBorrowerAccess,
  getLoanDetails,
);

router.get(
  '/:loanId/amortization-schedule',
  requireJwtAuth,
  requireScopes('read:loans'),
  requireLoanBorrowerAccess,
  getLoanAmortizationSchedule,
);

/**
 * @swagger
 * /loans/{loanId}/events:
 *   get:
 *     summary: Get events for a specific loan
 *     description: >
 *       Returns chronological loan events for the authenticated borrower.
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
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Loan events retrieved successfully
 *       401:
 *         description: Missing or invalid Bearer token
 *       404:
 *         description: Loan not found or not accessible
 */
router.get(
  '/:loanId/events',
  requireJwtAuth,
  requireScopes('read:loans'),
  requireLoanBorrowerAccess,
  getLoanEvents,
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
  '/request',
  requireJwtAuth,
  requireScopes('write:loans'),
  validateBody(requestLoanSchema),
  idempotencyMiddleware,
  requestLoan,
);

/**
 * @swagger
 * /loans/{loanId}/build-deposit-collateral:
 *   post:
 *     summary: Build an unsigned deposit_collateral transaction
 *     description: >
 *       Builds an unsigned Soroban `deposit_collateral(loan_id, amount)` transaction XDR.
 *       The borrower signs it and submits via POST /api/loans/submit.
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
 *                 type: integer
 *                 description: Amount of collateral to deposit
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key
 *     responses:
 *       200:
 *         description: Unsigned deposit_collateral transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan belongs to a different borrower
 */
router.post(
  '/:loanId/build-deposit-collateral',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
  validateParams(repayLoanParamsSchema),
  validateBody(depositCollateralSchema),
  idempotencyMiddleware,
  depositCollateral,
);

/**
 * @swagger
 * /loans/{loanId}/build-release-collateral:
 *   post:
 *     summary: Build an unsigned release_collateral transaction
 *     description: >
 *       Builds an unsigned Soroban `release_collateral(loan_id)` transaction XDR.
 *       The borrower signs it and submits via POST /api/loans/submit.
 *     tags: [Loans]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: loanId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Loan ID (must be repaid)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - borrowerPublicKey
 *             properties:
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key
 *     responses:
 *       200:
 *         description: Unsigned release_collateral transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan belongs to a different borrower
 */
router.post(
  '/:loanId/build-release-collateral',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
  validateParams(repayLoanParamsSchema),
  validateBody(releaseCollateralSchema),
  idempotencyMiddleware,
  releaseCollateral,
);

/**
 * @swagger
 * /loans/{loanId}/build-refinance:
 *   post:
 *     summary: Build an unsigned refinance_loan transaction
 *     description: >
 *       Builds an unsigned Soroban `refinance_loan(loan_id, new_amount, new_term)`
 *       transaction XDR. Both the admin and borrower must sign.
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
 *               - newAmount
 *               - newTerm
 *               - borrowerPublicKey
 *             properties:
 *               newAmount:
 *                 type: integer
 *                 description: New loan principal amount
 *               newTerm:
 *                 type: integer
 *                 description: New loan term in ledgers
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key
 *     responses:
 *       200:
 *         description: Unsigned refinance_loan transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan belongs to a different borrower
 */
router.post(
  '/:loanId/build-refinance',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
  validateParams(repayLoanParamsSchema),
  validateBody(refinanceLoanSchema),
  idempotencyMiddleware,
  refinanceLoan,
);

/**
 * @swagger
 * /loans/{loanId}/build-extend:
 *   post:
 *     summary: Build an unsigned extend_loan transaction
 *     description: >
 *       Builds an unsigned Soroban `extend_loan(borrower, loan_id, extra_ledgers)`
 *       transaction XDR. The borrower signs it and submits via POST /api/loans/submit.
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
 *               - extraLedgers
 *               - borrowerPublicKey
 *             properties:
 *               extraLedgers:
 *                 type: integer
 *                 description: Number of ledgers to extend the loan by
 *               borrowerPublicKey:
 *                 type: string
 *                 description: Borrower's Stellar public key
 *     responses:
 *       200:
 *         description: Unsigned extend_loan transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: Loan belongs to a different borrower
 */
router.post(
  '/:loanId/build-extend',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
  validateParams(repayLoanParamsSchema),
  validateBody(extendLoanSchema),
  idempotencyMiddleware,
  extendLoan,
);

/**
 * @swagger
 * /loans/{loanId}/liquidate/build:
 *   post:
 *     summary: Build an unsigned liquidate transaction
 *     description: >
 *       Builds an unsigned Soroban `liquidate(liquidator, loan_id)` transaction XDR.
 *       The liquidator signs it and submits via POST /api/loans/submit.
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
 *               - liquidatorPublicKey
 *             properties:
 *               liquidatorPublicKey:
 *                 type: string
 *                 description: Liquidator's Stellar public key
 *     responses:
 *       200:
 *         description: Unsigned liquidate transaction XDR returned
 *       400:
 *         description: Validation error
 *       401:
 *         description: Missing or invalid Bearer token
 *       403:
 *         description: liquidatorPublicKey does not match authenticated wallet
 */
router.post(
  '/:loanId/liquidate/build',
  requireJwtAuth,
  requireScopes('write:loans'),
  validateParams(repayLoanParamsSchema),
  validateBody(liquidateLoanSchema),
  idempotencyMiddleware,
  buildLiquidateLoan,
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
  '/submit',
  requireJwtAuth,
  requireScopes('write:loans'),
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
  '/:loanId/repay',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
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
  '/:loanId/submit',
  requireJwtAuth,
  requireScopes('write:loans'),
  requireLoanOwner,
  validateParams(repayLoanParamsSchema),
  validateBody(submitTxSchema),
  idempotencyMiddleware,
  submitTransaction,
);

export default router;
