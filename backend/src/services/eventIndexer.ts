import { rpc, xdr } from "@stellar/stellar-sdk";
import { query } from "../db/connection.js";
import logger from "../utils/logger.js";

interface IndexerConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs: number;
  batchSize: number;
}

interface LoanEvent {
  eventId: string;
  eventType: "LoanRequested" | "LoanApproved" | "LoanRepaid";
  loanId?: number;
  borrower: string;
  amount?: string;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: string[];
  value: string;
}

export class EventIndexer {
  private server: rpc.Server;
  private config: IndexerConfig;
  private isRunning: boolean = false;
  private pollTimeout?: NodeJS.Timeout;

  constructor(config: IndexerConfig) {
    this.config = config;
    this.server = new rpc.Server(config.rpcUrl);
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("Starting event indexer");
    await this.poll();
  }

  stop(): void {
    this.isRunning = false;
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
  }

  private async poll(): Promise<void> {
    if (!this.isRunning) return;
    try { await this.indexEvents(); } catch (error) { logger.error("Indexing error", { error }); }
    this.pollTimeout = setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  private async indexEvents(): Promise<void> {
    const state = await this.getIndexerState();
    const response = await this.server.getEvents({
      startLedger: state.lastIndexedLedger + 1,
      filters: [{ type: "contract", contractIds: [this.config.contractId] }],
      limit: this.config.batchSize,
    });
    if (!response.events?.length) return;
    
    const events = await this.processEvents(response.events);
    await this.storeEvents(events);
    const last = response.events[response.events.length - 1];
    if (last) await this.updateIndexerState(last.ledger, response.cursor || "");
  }

  private async processEvents(events: rpc.Api.EventResponse[]): Promise<LoanEvent[]> {
    const result: LoanEvent[] = [];
    for (const e of events) {
      try {
        if (e.type !== "contract" || !e.topic?.[0] || !e.topic[1] || !e.contractId) continue;
        const type = this.decodeEventType(e.topic[0]);
        if (!type) continue;
        const evt: LoanEvent = {
          eventId: e.id, eventType: type, borrower: this.decodeAddress(e.topic[1]),
          ledger: e.ledger, ledgerClosedAt: new Date(e.ledgerClosedAt), txHash: e.txHash,
          contractId: e.contractId.toString(), topics: e.topic.map(t => t.toXDR("base64")),
          value: e.value.toXDR("base64"), amount: this.decodeAmount(e.value)
        };
        if (e.topic[2]) evt.loanId = this.decodeLoanId(e.topic[2]);
        result.push(evt);
      } catch (err) { logger.error("Process event error", { err }); }
    }
    return result;
  }

  private async storeEvents(events: LoanEvent[]): Promise<void> {
    if (!events.length) return;
    try {
      await query("BEGIN", []);
      for (const e of events) {
        const ex = await query("SELECT id FROM loan_events WHERE event_id = $1", [e.eventId]);
        if (ex.rows.length) continue;
        await query(
          `INSERT INTO loan_events (event_id, event_type, loan_id, borrower, amount, ledger, ledger_closed_at, tx_hash, contract_id, topics, value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [e.eventId, e.eventType, e.loanId || null, e.borrower, e.amount || null, e.ledger, e.ledgerClosedAt, e.txHash, e.contractId, JSON.stringify(e.topics), e.value]
        );
      }
      await query("COMMIT", []);
    } catch (err) { await query("ROLLBACK", []); throw err; }
  }

  private async getIndexerState() {
    const r = await query("SELECT last_indexed_ledger, last_indexed_cursor FROM indexer_state ORDER BY id DESC LIMIT 1", []);
    return r.rows[0] || { lastIndexedLedger: 0, lastIndexedCursor: null };
  }

  private async updateIndexerState(ledger: number, cursor: string) {
    await query("UPDATE indexer_state SET last_indexed_ledger = $1, last_indexed_cursor = $2, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM indexer_state ORDER BY id DESC LIMIT 1)", [ledger, cursor]);
  }

  private encodeSymbol(s: string) { return xdr.ScVal.scvSymbol(s).toXDR("base64"); }
  private decodeEventType(x: xdr.ScVal): "LoanRequested" | "LoanApproved" | "LoanRepaid" | null {
    try { const s = x.sym().toString(); return (s === "LoanRequested" || s === "LoanApproved" || s === "LoanRepaid") ? s : null; } catch { return null; }
  }
  private decodeAddress(x: xdr.ScVal): string { try { return x.address().toString(); } catch { return ""; } }
  private decodeAmount(x: xdr.ScVal): string { try { return x.i128().toString(); } catch { return "0"; } }
  private decodeLoanId(x: xdr.ScVal): number { try { return x.u32(); } catch { return 0; } }
}
