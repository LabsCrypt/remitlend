import type { Response } from "express";
import logger from "../utils/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoanEventPayload {
  eventId: string;
  eventType: string;
  loanId?: number | undefined;
  borrower: string;
  amount?: string | undefined;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
}

type SseClient = Response;

interface ClientInfo {
  res: SseClient;
  userKey: string;
}

const MAX_CONNECTIONS_PER_USER = 3;

/** Borrower-specific SSE clients: borrowerPublicKey → Set<ClientInfo> */
const borrowerClients = new Map<string, Set<ClientInfo>>();

/** Admin SSE clients listening to all events */
const adminClients = new Set<ClientInfo>();

/** All SSE clients grouped by authenticated user key for connection limiting */
const userClients = new Map<string, Set<SseClient>>();

// ─── Event Stream Service ─────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;

class EventStreamService {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  closeAll: any;

  startHeartbeat(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const allClients = this.collectAllClients();
      for (const res of allClients) {
        try {
          res.write(": ping\n\n");
        } catch {
          this.removeClient(res);
        }
      }

      const counts = this.getConnectionCount();
      logger.info("SSE heartbeat", {
        borrower: counts.borrower,
        admin: counts.admin,
        total: counts.total,
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private stopHeartbeatIfEmpty(): void {
    if (this.getConnectionCount().total === 0) {
      this.stopHeartbeat();
    }
  }

  private collectAllClients(): Set<SseClient> {
    const all = new Set<SseClient>();
    for (const clients of borrowerClients.values()) {
      for (const client of clients) {
        all.add(client);
      }
    }
    for (const client of adminClients) {
      all.add(client);
    }
    return all;
  }

  private removeClient(res: SseClient): void {
    for (const [borrower, clients] of borrowerClients) {
      clients.delete(res);
      if (clients.size === 0) {
        borrowerClients.delete(borrower);
      }
    }
    adminClients.delete(res);
    for (const [userKey, clients] of userClients) {
      clients.delete(res);
      if (clients.size === 0) {
        userClients.delete(userKey);
      }
    }
  }

  sendEvent(res: SseClient, event: LoanEventPayload): void {
    const payload =
      `id: ${event.eventId}\n` +
      `event: loan-event\n` +
      `data: ${JSON.stringify(event)}\n\n`;

    res.write(payload);
  }

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
    const clientInfo: ClientInfo = { res, userKey };
    borrowerClients.get(borrower)!.add(clientInfo);
    this.registerUserClient(userKey, res);
    this.startHeartbeat();

    logger.info("SSE client subscribed to borrower events", {
      borrower,
      userKey,
      activeConnections: this.getUserConnectionCount(userKey),
    });

    return () => {
      borrowerClients.get(borrower)?.delete(clientInfo);
      if (borrowerClients.get(borrower)?.size === 0) {
        borrowerClients.delete(borrower);
      }
      this.unregisterUserClient(userKey, res);
      this.stopHeartbeatIfEmpty();
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
    const clientInfo: ClientInfo = { res, userKey };
    adminClients.add(clientInfo);
    this.registerUserClient(userKey, res);
    this.startHeartbeat();

    logger.info("SSE admin client subscribed to all events", {
      userKey,
      activeConnections: this.getUserConnectionCount(userKey),
    });

    return () => {
      adminClients.delete(clientInfo);
      this.unregisterUserClient(userKey, res);
      this.stopHeartbeatIfEmpty();
      logger.info("SSE admin client unsubscribed from all events", {
        userKey,
        activeConnections: this.getUserConnectionCount(userKey),
      });
    };
  }

  /**
   * Broadcasts a loan event to relevant SSE clients:
   * - Borrower-specific clients for that borrower (with user identity verification)
   * - All admin clients
   */
  broadcast(event: LoanEventPayload): void {
    // Push to borrower-specific clients with user identity verification
    if (event.borrower) {
      const clients = borrowerClients.get(event.borrower);
      if (clients?.size) {
        const clientsToRemove: ClientInfo[] = [];
        for (const clientInfo of clients) {
          try {
            // Verify user identity before sending (fixes #471)
            this.sendEvent(
              clientInfo.res,
              event,
              clientInfo.userKey,
              event.borrower,
            );
          } catch (err) {
            logger.error("SSE write error (borrower)", {
              borrower: event.borrower,
              userKey: clientInfo.userKey,
              err,
            });
            clientsToRemove.push(clientInfo);
          }
        }
        // Remove failed clients after iteration
        for (const clientInfo of clientsToRemove) {
          clients.delete(clientInfo);
        }
      }
    }

    // Push to admin clients
    const adminsToRemove: ClientInfo[] = [];
    for (const clientInfo of adminClients) {
      try {
        this.sendEvent(clientInfo.res, event);
      } catch (err) {
        logger.error("SSE write error (admin)", {
          userKey: clientInfo.userKey,
          err,
        });
        adminsToRemove.push(clientInfo);
      }
    }
    // Remove failed clients after iteration
    for (const clientInfo of adminsToRemove) {
      adminClients.delete(clientInfo);
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
    this.stopHeartbeat();
    const clients = new Set<SseClient>();

    for (const borrowerClientSet of borrowerClients.values()) {
      for (const clientInfo of borrowerClientSet) {
        clients.add(clientInfo);
      }
    }

    for (const clientInfo of adminClients) {
      clients.add(clientInfo);
    }

    const shutdownPayload =
      `event: shutdown\n` +
      `data: ${JSON.stringify({ type: "shutdown", message })}\n\n`;

    for (const clientInfo of clients) {
      try {
        clientInfo.res.write(shutdownPayload);
      } catch (err) {
        logger.error("SSE shutdown write error", {
          userKey: clientInfo.userKey,
          err,
        });
      }

      try {
        clientInfo.res.end();
      } catch (err) {
        logger.error("SSE shutdown close error", {
          userKey: clientInfo.userKey,
          err,
        });
      }
    }

    borrowerClients.clear();
    adminClients.clear();
    userClients.clear();
  }

  reset(): void {
    this.stopHeartbeat();
    borrowerClients.clear();
    adminClients.clear();
    userClients.clear();
  }
}

export const eventStreamService = new EventStreamService();
