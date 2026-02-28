import { Router } from "express";
import {
  getBorrowerLoans,
  getLoanDetails,
} from "../controllers/loanController.js";

const router = Router();

/**
 * @swagger
 * /loans/borrower/{borrower}:
 *   get:
 *     summary: Get loans for a specific borrower
 *     description: Returns all loans associated with a borrower address
 *     tags: [Loans]
 *     parameters:
 *       - in: path
 *         name: borrower
 *         required: true
 *         schema:
 *           type: string
 *         description: Borrower's Stellar address
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, repaid, all]
 *           default: active
 *     responses:
 *       200:
 *         description: Loans retrieved successfully
 */
router.get("/borrower/:borrower", getBorrowerLoans);

/**
 * @swagger
 * /loans/{loanId}:
 *   get:
 *     summary: Get loan details
 *     description: Returns detailed information about a specific loan
 *     tags: [Loans]
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
 */
router.get("/:loanId", getLoanDetails);

export default router;
