import type { Response } from "express";
import logger from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoanEventPayload {
  eventId: string;
  eventType: string;
  loanId?: number;
  borrower: string;
  amount?: string;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

// ─── SSE client registry ──────────────────────────────────────────────────────

type SseClient = Response;

const MAX_CONNECTIONS_PER_USER = 3;

/** Borrower-specific SSE clients: borrowerPublicKey → Set<Response> */
const borrowerClients = new Map<string, Set<SseClient>>();

/** Admin SSE clients listening to all events */
const adminClients = new Set<SseClient>();

/** All SSE clients grouped by authenticated user key for connection limiting */
const userClients = new Map<string, Set<SseClient>>();

// ─── Event Stream Service ─────────────────────────────────────────────────────

class EventStreamService {
  private registerUserClient(userKey: string, res: SseClient): void {
    if (!userClients.has(userKey)) {
      userClients.set(userKey, new Set());
    }
    userClients.get(userKey)!.add(res);
  }

  private unregisterUserClient(userKey: string, res: SseClient): void {
    const clients = userClients.get(userKey);
    if (!clients) {
      return;
    }

    clients.delete(res);
    if (clients.size === 0) {
      userClients.delete(userKey);
    }
  }

  canOpenConnection(userKey: string): boolean {
    return (userClients.get(userKey)?.size ?? 0) < MAX_CONNECTIONS_PER_USER;
  }

  getUserConnectionCount(userKey: string): number {
    return userClients.get(userKey)?.size ?? 0;
  }

  getMaxConnectionsPerUser(): number {
    return MAX_CONNECTIONS_PER_USER;
  }

  /**
   * Registers an SSE client for a specific borrower's events.
   * Returns an unsubscribe function for cleanup on disconnect.
   */
  subscribeBorrower(
    userKey: string,
    borrower: string,
    res: SseClient,
  ): () => void {
    if (!borrowerClients.has(borrower)) {
      borrowerClients.set(borrower, new Set());
    }
    borrowerClients.get(borrower)!.add(res);
    this.registerUserClient(userKey, res);

    logger.info("SSE client subscribed to borrower events", {
      borrower,
      userKey,
      activeConnections: this.getUserConnectionCount(userKey),
    });

    return () => {
      borrowerClients.get(borrower)?.delete(res);
      if (borrowerClients.get(borrower)?.size === 0) {
        borrowerClients.delete(borrower);
      }
      this.unregisterUserClient(userKey, res);
      logger.info("SSE client unsubscribed from borrower events", {
        borrower,
        userKey,
        activeConnections: this.getUserConnectionCount(userKey),
      });
    };
  }

  /**
   * Registers an SSE client for all events (admin stream).
   * Returns an unsubscribe function for cleanup on disconnect.
   */
  subscribeAll(userKey: string, res: SseClient): () => void {
    adminClients.add(res);
    this.registerUserClient(userKey, res);

    logger.info("SSE admin client subscribed to all events", {
      userKey,
      activeConnections: this.getUserConnectionCount(userKey),
    });

    return () => {
      adminClients.delete(res);
      this.unregisterUserClient(userKey, res);
      logger.info("SSE admin client unsubscribed from all events", {
        userKey,
        activeConnections: this.getUserConnectionCount(userKey),
      });
    };
  }

  /**
   * Broadcasts a loan event to relevant SSE clients:
   * - Borrower-specific clients for that borrower
   * - All admin clients
   */
  broadcast(event: LoanEventPayload): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;

    // Push to borrower-specific clients
    if (event.borrower) {
      const clients = borrowerClients.get(event.borrower);
      if (clients?.size) {
        for (const res of clients) {
          try {
            res.write(data);
          } catch (err) {
            logger.error("SSE write error (borrower)", {
              borrower: event.borrower,
              err,
            });
            clients.delete(res);
          }
        }
      }
    }

    // Push to admin clients
    for (const res of adminClients) {
      try {
        res.write(data);
      } catch (err) {
        logger.error("SSE write error (admin)", { err });
        adminClients.delete(res);
      }
    }
  }

  /** Returns the number of active SSE connections. */
  getConnectionCount(): { borrower: number; admin: number; total: number } {
    let borrowerCount = 0;
    for (const clients of borrowerClients.values()) {
      borrowerCount += clients.size;
    }
    return {
      borrower: borrowerCount,
      admin: adminClients.size,
      total: borrowerCount + adminClients.size,
    };
  }

  closeAllConnections(message = "Server shutting down"): void {
    const clients = new Set<SseClient>();

    for (const borrowerClientSet of borrowerClients.values()) {
      for (const client of borrowerClientSet) {
        clients.add(client);
      }
    }

    for (const client of adminClients) {
      clients.add(client);
    }

    const shutdownPayload =
      `event: shutdown\n` +
      `data: ${JSON.stringify({ type: "shutdown", message })}\n\n`;

    for (const client of clients) {
      try {
        client.write(shutdownPayload);
      } catch (err) {
        logger.error("SSE shutdown write error", { err });
      }

      try {
        client.end();
      } catch (err) {
        logger.error("SSE shutdown close error", { err });
      }
    }

    borrowerClients.clear();
    adminClients.clear();
    userClients.clear();
  }

  reset(): void {
    borrowerClients.clear();
    adminClients.clear();
    userClients.clear();
  }
}

export const eventStreamService = new EventStreamService();
