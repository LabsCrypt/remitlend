import crypto from "crypto";
import {
  Account,
  Asset,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { getStellarNetworkPassphrase } from "../config/stellar.js";
import { query } from "../db/connection.js";
import { withTransaction } from "../db/transaction.js";
import { AppError } from "../errors/AppError.js";
import logger from "../utils/logger.js";

export interface CreateRemittancePayload {
  recipientAddress: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  memo?: string;
  senderAddress: string;
}

export interface Remittance {
  id: string;
  senderId: string;
  recipientAddress: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  memo?: string;
  status: "pending" | "processing" | "completed" | "failed";
  transactionHash?: string;
  xdr?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Validates a Stellar public key format
 */
function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  if (address.length !== 56 || !address.startsWith("G")) return false;
  return /^G[A-Z2-7]{55}$/.test(address);
}

const normalizeCurrency = (currency: string): string =>
  currency.trim().toUpperCase();

const getCurrencyAsset = (currency: string): Asset => {
  const normalized = normalizeCurrency(currency);

  if (normalized === "XLM") {
    return Asset.native();
  }

  const tokenIssuers: Record<string, string | undefined> = {
    USDC: process.env.STELLAR_USDC_ISSUER,
    EURC: process.env.STELLAR_EURC_ISSUER,
    PHP: process.env.STELLAR_PHP_ISSUER,
  };

  const issuer = tokenIssuers[normalized];
  if (!issuer) {
    throw AppError.badRequest(`Unsupported currency: ${currency}`);
  }

  if (!isValidStellarAddress(issuer)) {
    throw AppError.badRequest(
      `Unsupported currency: ${currency} (issuer is not configured correctly)`,
    );
  }

  return new Asset(normalized, issuer);
};

export const remittanceService = {
  /**
   * Create a new remittance record and generate XDR
   */
  async createRemittance(
    payload: CreateRemittancePayload,
  ): Promise<Remittance> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Validate before opening a DB transaction — avoids holding a connection
    // while doing synchronous checks.
    if (!isValidStellarAddress(payload.recipientAddress)) {
      throw AppError.badRequest(
        "Invalid Stellar recipient address (must be 56 chars, start with G)",
      );
    }

    if (!isValidStellarAddress(payload.senderAddress)) {
      throw AppError.badRequest(
        "Invalid Stellar sender address (must be 56 chars, start with G)",
      );
    }

    const paymentAsset = getCurrencyAsset(payload.fromCurrency);
    const normalizedFromCurrency = normalizeCurrency(payload.fromCurrency);
    const normalizedToCurrency = normalizeCurrency(payload.toCurrency);

    try {
      const networkPassphrase = getStellarNetworkPassphrase();

      const sourceAccount = new Account(payload.senderAddress, "0");

      const transaction = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase: networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: payload.recipientAddress,
            asset: paymentAsset,
            amount: payload.amount.toString(),
          }),
        )
        .setTimeout(30)
        .build();

      const xdr = transaction.toXDR();

      // Wrap all DB writes in a transaction so a partial failure cannot leave
      // the database in an inconsistent half-written state.
      return await withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO remittances
           (id, sender_id, recipient_address, amount, from_currency, to_currency, memo, status, xdr, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            id,
            payload.senderAddress,
            payload.recipientAddress,
            payload.amount,
            normalizedFromCurrency,
            normalizedToCurrency,
            payload.memo || null,
            "pending",
            xdr,
            now,
            now,
          ],
        );

        if (!result.rows[0]) {
          throw AppError.internal("Failed to create remittance record");
        }

        const record = result.rows[0];

        return {
          id: record.id,
          senderId: record.sender_id,
          recipientAddress: record.recipient_address,
          amount: parseFloat(record.amount),
          fromCurrency: record.from_currency,
          toCurrency: record.to_currency,
          memo: record.memo,
          status: record.status,
          transactionHash: record.transaction_hash,
          xdr: record.xdr,
          createdAt: record.created_at.toISOString(),
          updatedAt: record.updated_at.toISOString(),
        };
      });
    } catch (error) {
      logger.error("Error creating remittance:", error);

      if (error instanceof AppError) throw error;

      throw AppError.internal("Failed to create remittance");
    }
  },

  async getRemittances(
    userId: string,
    limit: number = 20,
    cursor: string | null = null,
    status?: string,
  ): Promise<{
    remittances: Remittance[];
    total: number;
    nextCursor: string | null;
  }> {
    try {
      let whereClause = "sender_id = $1";
      const params: (string | number)[] = [userId];

      if (status && status !== "all") {
        whereClause += " AND status = $2";
        params.push(status);
      }

      const cursorValue = cursor ? new Date(cursor) : null;
      if (cursor && (!cursorValue || Number.isNaN(cursorValue.getTime()))) {
        throw AppError.badRequest("Invalid cursor");
      }

      if (cursorValue) {
        whereClause += ` AND created_at < $${params.length + 1}`;
        params.push(cursorValue.toISOString());
      }

      const result = await query(
        `SELECT * FROM remittances 
         WHERE ${whereClause}
         ORDER BY created_at DESC, id DESC
         LIMIT $${params.length + 1}`,
        [...params, limit + 1],
      );

      const countResult = await query(
        `SELECT COUNT(*) as total FROM remittances WHERE ${whereClause}`,
        params,
      );

      const hasNext = result.rows.length > limit;
      const trimmed = hasNext ? result.rows.slice(0, limit) : result.rows;

      const remittances = trimmed.map((r) => ({
        id: r.id,
        senderId: r.sender_id,
        recipientAddress: r.recipient_address,
        amount: parseFloat(r.amount),
        fromCurrency: r.from_currency,
        toCurrency: r.to_currency,
        memo: r.memo,
        status: r.status,
        transactionHash: r.transaction_hash,
        xdr: r.xdr,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      }));

      const lastRemittance =
        remittances.length > 0
          ? remittances[remittances.length - 1]
          : undefined;
      const nextCursor =
        hasNext && lastRemittance ? lastRemittance.createdAt : null;

      return {
        remittances,
        total: parseInt(countResult.rows[0]?.total || "0", 10),
        nextCursor,
      };
    } catch (error) {
      logger.error("Error fetching remittances:", error);

      if (error instanceof AppError) {
        throw error;
      }

      throw AppError.internal("Failed to fetch remittances");
    }
  },

  async getRemittance(id: string): Promise<Remittance> {
    try {
      const result = await query("SELECT * FROM remittances WHERE id = $1", [
        id,
      ]);

      if (!result.rows[0]) throw AppError.notFound("Remittance not found");

      const r = result.rows[0];

      return {
        id: r.id,
        senderId: r.sender_id,
        recipientAddress: r.recipient_address,
        amount: parseFloat(r.amount),
        fromCurrency: r.from_currency,
        toCurrency: r.to_currency,
        memo: r.memo,
        status: r.status,
        transactionHash: r.transaction_hash,
        xdr: r.xdr,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
    } catch (error) {
      logger.error("Error fetching remittance:", error);

      if (error instanceof AppError) {
        throw error;
      }

      throw AppError.internal("Failed to fetch remittance");
    }
  },

  async updateRemittanceStatus(
    id: string,
    status: "processing" | "completed" | "failed",
    transactionHash?: string,
    errorMessage?: string,
  ): Promise<Remittance> {
    try {
      const result = await query(
        `UPDATE remittances 
         SET status = $1, transaction_hash = $2, error_message = $3, updated_at = $4
         WHERE id = $5
         RETURNING *`,
        [
          status,
          transactionHash || null,
          errorMessage || null,
          new Date().toISOString(),
          id,
        ],
      );

      if (!result.rows[0]) {
        throw AppError.notFound("Remittance not found");
      }

      const r = result.rows[0];

      return {
        id: r.id,
        senderId: r.sender_id,
        recipientAddress: r.recipient_address,
        amount: parseFloat(r.amount),
        fromCurrency: r.from_currency,
        toCurrency: r.to_currency,
        memo: r.memo,
        status: r.status,
        transactionHash: r.transaction_hash,
        xdr: r.xdr,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
    } catch (error) {
      logger.error("Error updating remittance:", error);

      if (error instanceof AppError) {
        throw error;
      }

      throw AppError.internal("Failed to update remittance");
    }
  },
};
