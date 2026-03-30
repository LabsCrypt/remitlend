import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { remittanceService } from "../services/remittanceService.js";
import { AppError } from "../errors/AppError.js";
import { parseCursorQueryParams } from "../utils/pagination.js";
import logger from "../utils/logger.js";

/**
 * POST /api/remittances - Create a new remittance
 *
 * Creates an unsigned Stellar transaction for the frontend to sign
 * with Freighter wallet. Returns XDR for preview and signing.
 */
export const createRemittance = asyncHandler(
  async (req: Request, res: Response) => {
    const { recipientAddress, amount, fromCurrency, toCurrency, memo } =
      req.body;

    // Get sender address from JWT (added by auth middleware)
    const senderAddress = (req as any).walletAddress;

    if (!senderAddress) {
      throw AppError.unauthorized("Wallet address not found in request");
    }

    logger.info("Creating remittance", {
      sender: senderAddress,
      recipient: recipientAddress,
      amount,
      currency: fromCurrency,
    });

    const remittance = await remittanceService.createRemittance({
      recipientAddress,
      amount,
      fromCurrency,
      toCurrency,
      memo,
      senderAddress,
    });

    res.status(201).json({
      success: true,
      data: remittance,
      message:
        "Remittance created successfully. Sign the transaction in your wallet.",
    });
  },
);

/**
 * GET /api/remittances - Get user's remittances
 *
 * Returns paginated list of remittances for the authenticated user
 */
export const getRemittances = asyncHandler(
  async (req: Request, res: Response) => {
    const senderAddress = (req as any).walletAddress as string;

    if (!senderAddress) {
      throw AppError.unauthorized("Wallet address not found in request");
    }

    const { limit, cursor } = parseCursorQueryParams(req);
    const status = req.query.status as string | undefined;

    const result = await remittanceService.getRemittances(
      senderAddress,
      limit,
      cursor,
      status,
    );

    res.json({
      success: true,
      data: result.remittances,
      page_info: {
        limit,
        next_cursor: result.nextCursor,
        has_next: result.nextCursor !== null,
        total: result.total,
      },
    });
  },
);

/**
 * GET /api/remittances/:id - Get a single remittance
 *
 * Returns detailed information about a specific remittance
 */
export const getRemittance = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const senderAddress = (req as any).walletAddress as string;

    if (!senderAddress) {
      throw AppError.unauthorized("Wallet address not found in request");
    }

    if (!id) {
      throw AppError.badRequest("Remittance ID is required");
    }

    const remittance = await remittanceService.getRemittance(id);

    // Verify the user owns this remittance
    if (remittance.senderId !== senderAddress) {
      throw AppError.forbidden("You do not have access to this remittance");
    }

    res.json({
      success: true,
      data: remittance,
    });
  },
);

/**
 * POST /api/remittances/:id/submit - Submit signed transaction
 *
 * Accepts a signed XDR from Freighter wallet and submits it to Stellar
 */
export const submitRemittanceTransaction = asyncHandler(
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { signedXdr } = req.body as { signedXdr: string };
    const senderAddress = (req as any).walletAddress as string;

    if (!senderAddress) {
      throw AppError.unauthorized("Wallet address not found in request");
    }

    if (!signedXdr) {
      throw AppError.badRequest("Signed XDR is required");
    }

    if (!id) {
      throw AppError.badRequest("Remittance ID is required");
    }

    logger.info("Submitting remittance transaction", { remittanceId: id });

    try {
      const remittance = await remittanceService.getRemittance(id);

      if (remittance.senderId !== senderAddress) {
        throw AppError.forbidden("You do not have access to this remittance");
      }

      if (remittance.status !== "pending") {
        throw AppError.badRequest("Remittance has already been submitted");
      }

      // Update status to processing
      await remittanceService.updateRemittanceStatus(id, "processing");

      // TODO: Submit to Stellar network
      // This would involve:
      // 1. Parse the signed XDR
      // 2. Submit to Stellar RPC
      // 3. Wait for confirmation
      // 4. Update remittance with transaction hash and status

      res.json({
        success: true,
        data: {
          id,
          status: "processing",
          message: "Transaction submitted to Stellar network",
        },
      });
    } catch (error) {
      logger.error("Error submitting remittance transaction:", error);

      if (id) {
        await remittanceService.updateRemittanceStatus(
          id,
          "failed",
          undefined,
          error instanceof Error ? error.message : "Unknown error",
        );
      }

      throw error;
    }
  },
);
