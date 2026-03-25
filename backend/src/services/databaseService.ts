import { query, getClient } from "../db/connection.js";
import type { PoolClient } from "pg";

export interface UserProfile {
  id: number;
  public_key: string;
  display_name?: string;
  email?: string;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
}

export interface CreateUserProfileInput {
  public_key: string;
  display_name?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateUserProfileInput {
  display_name?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}

export class UserProfileService {
  static async create(input: CreateUserProfileInput): Promise<UserProfile> {
    const result = await query(
      `INSERT INTO user_profiles (public_key, display_name, email, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.public_key, input.display_name, input.email, input.metadata],
    );
    return result.rows[0] as UserProfile;
  }

  static async findByPublicKey(publicKey: string): Promise<UserProfile | null> {
    const result = await query(
      `SELECT * FROM user_profiles WHERE public_key = $1`,
      [publicKey],
    );
    return (result.rows[0] as UserProfile) || null;
  }

  static async findById(id: number): Promise<UserProfile | null> {
    const result = await query(`SELECT * FROM user_profiles WHERE id = $1`, [
      id,
    ]);
    return (result.rows[0] as UserProfile) || null;
  }

  static async update(
    publicKey: string,
    input: UpdateUserProfileInput,
  ): Promise<UserProfile | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.display_name !== undefined) {
      updates.push(`display_name = $${paramIndex++}`);
      values.push(input.display_name);
    }
    if (input.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(input.email);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(input.metadata);
    }

    if (updates.length === 0) {
      return this.findByPublicKey(publicKey);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(publicKey);

    const result = await query(
      `UPDATE user_profiles SET ${updates.join(", ")} WHERE public_key = $${paramIndex} RETURNING *`,
      values,
    );
    return (result.rows[0] as UserProfile) || null;
  }

  static async delete(publicKey: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM user_profiles WHERE public_key = $1`,
      [publicKey],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async upsert(input: CreateUserProfileInput): Promise<UserProfile> {
    const result = await query(
      `INSERT INTO user_profiles (public_key, display_name, email, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (public_key) 
       DO UPDATE SET 
         display_name = COALESCE($2, user_profiles.display_name),
         email = COALESCE($3, user_profiles.email),
         metadata = COALESCE($4, user_profiles.metadata),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [input.public_key, input.display_name, input.email, input.metadata],
    );
    return result.rows[0] as UserProfile;
  }
}

export interface LoanHistory {
  id: number;
  loan_id: number;
  borrower_public_key: string;
  lender_public_key?: string;
  principal_amount: number;
  interest_rate_bps: number;
  principal_paid: number;
  interest_paid: number;
  accrued_interest: number;
  status: string;
  due_date?: Date;
  requested_at?: Date;
  approved_at?: Date;
  repaid_at?: Date;
  defaulted_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, unknown>;
}

export interface CreateLoanHistoryInput {
  loan_id: number;
  borrower_public_key: string;
  lender_public_key?: string;
  principal_amount: number;
  interest_rate_bps: number;
  status: string;
  due_date?: Date;
  requested_at?: Date;
  metadata?: Record<string, unknown>;
}

export interface UpdateLoanHistoryInput {
  principal_paid?: number;
  interest_paid?: number;
  accrued_interest?: number;
  status?: string;
  approved_at?: Date;
  repaid_at?: Date;
  defaulted_at?: Date;
  metadata?: Record<string, unknown>;
}

export class LoanHistoryService {
  static async create(input: CreateLoanHistoryInput): Promise<LoanHistory> {
    const result = await query(
      `INSERT INTO loan_history 
        (loan_id, borrower_public_key, lender_public_key, principal_amount, 
         interest_rate_bps, status, due_date, requested_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.loan_id,
        input.borrower_public_key,
        input.lender_public_key,
        input.principal_amount,
        input.interest_rate_bps,
        input.status,
        input.due_date,
        input.requested_at,
        input.metadata,
      ],
    );
    return result.rows[0] as LoanHistory;
  }

  static async findByLoanId(loanId: number): Promise<LoanHistory | null> {
    const result = await query(
      `SELECT * FROM loan_history WHERE loan_id = $1`,
      [loanId],
    );
    return (result.rows[0] as LoanHistory) || null;
  }

  static async findByBorrower(
    publicKey: string,
    limit = 50,
    offset = 0,
  ): Promise<LoanHistory[]> {
    const result = await query(
      `SELECT * FROM loan_history 
       WHERE borrower_public_key = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [publicKey, limit, offset],
    );
    return result.rows as LoanHistory[];
  }

  static async findByLender(
    publicKey: string,
    limit = 50,
    offset = 0,
  ): Promise<LoanHistory[]> {
    const result = await query(
      `SELECT * FROM loan_history 
       WHERE lender_public_key = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [publicKey, limit, offset],
    );
    return result.rows as LoanHistory[];
  }

  static async update(
    loanId: number,
    input: UpdateLoanHistoryInput,
  ): Promise<LoanHistory | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.principal_paid !== undefined) {
      updates.push(`principal_paid = $${paramIndex++}`);
      values.push(input.principal_paid);
    }
    if (input.interest_paid !== undefined) {
      updates.push(`interest_paid = $${paramIndex++}`);
      values.push(input.interest_paid);
    }
    if (input.accrued_interest !== undefined) {
      updates.push(`accrued_interest = $${paramIndex++}`);
      values.push(input.accrued_interest);
    }
    if (input.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(input.status);
    }
    if (input.approved_at !== undefined) {
      updates.push(`approved_at = $${paramIndex++}`);
      values.push(input.approved_at);
    }
    if (input.repaid_at !== undefined) {
      updates.push(`repaid_at = $${paramIndex++}`);
      values.push(input.repaid_at);
    }
    if (input.defaulted_at !== undefined) {
      updates.push(`defaulted_at = $${paramIndex++}`);
      values.push(input.defaulted_at);
    }
    if (input.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(input.metadata);
    }

    if (updates.length === 0) {
      return this.findByLoanId(loanId);
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(loanId);

    const result = await query(
      `UPDATE loan_history SET ${updates.join(", ")} WHERE loan_id = $${paramIndex} RETURNING *`,
      values,
    );
    return (result.rows[0] as LoanHistory) || null;
  }

  static async findByStatus(
    status: string,
    limit = 50,
    offset = 0,
  ): Promise<LoanHistory[]> {
    const result = await query(
      `SELECT * FROM loan_history 
       WHERE status = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [status, limit, offset],
    );
    return result.rows as LoanHistory[];
  }
}

export interface IndexedEvent {
  id: number;
  event_id: string;
  event_type: string;
  contract_id: string;
  tx_hash: string;
  ledger: number;
  ledger_closed_at: Date;
  topics?: Record<string, unknown>;
  value?: string;
  processed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CreateIndexedEventInput {
  event_id: string;
  event_type: string;
  contract_id: string;
  tx_hash: string;
  ledger: number;
  ledger_closed_at: Date;
  topics?: Record<string, unknown>;
  value?: string;
}

export class IndexedEventsService {
  static async create(input: CreateIndexedEventInput): Promise<IndexedEvent> {
    const result = await query(
      `INSERT INTO indexed_events 
        (event_id, event_type, contract_id, tx_hash, ledger, ledger_closed_at, topics, value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING *`,
      [
        input.event_id,
        input.event_type,
        input.contract_id,
        input.tx_hash,
        input.ledger,
        input.ledger_closed_at,
        input.topics,
        input.value,
      ],
    );
    return result.rows[0] as IndexedEvent;
  }

  static async findById(id: number): Promise<IndexedEvent | null> {
    const result = await query(`SELECT * FROM indexed_events WHERE id = $1`, [
      id,
    ]);
    return (result.rows[0] as IndexedEvent) || null;
  }

  static async findByEventId(eventId: string): Promise<IndexedEvent | null> {
    const result = await query(
      `SELECT * FROM indexed_events WHERE event_id = $1`,
      [eventId],
    );
    return (result.rows[0] as IndexedEvent) || null;
  }

  static async findUnprocessed(limit = 100): Promise<IndexedEvent[]> {
    const result = await query(
      `SELECT * FROM indexed_events 
       WHERE processed = false 
       ORDER BY ledger ASC 
       LIMIT $1`,
      [limit],
    );
    return result.rows as IndexedEvent[];
  }

  static async markProcessed(eventId: string): Promise<boolean> {
    const result = await query(
      `UPDATE indexed_events 
       SET processed = true, updated_at = CURRENT_TIMESTAMP 
       WHERE event_id = $1`,
      [eventId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async findByTxHash(txHash: string): Promise<IndexedEvent[]> {
    const result = await query(
      `SELECT * FROM indexed_events WHERE tx_hash = $1 ORDER BY ledger ASC`,
      [txHash],
    );
    return result.rows as IndexedEvent[];
  }

  static async findByContract(
    contractId: string,
    limit = 50,
    offset = 0,
  ): Promise<IndexedEvent[]> {
    const result = await query(
      `SELECT * FROM indexed_events 
       WHERE contract_id = $1 
       ORDER BY ledger DESC 
       LIMIT $2 OFFSET $3`,
      [contractId, limit, offset],
    );
    return result.rows as IndexedEvent[];
  }

  static async deleteByLedgerRange(
    startLedger: number,
    endLedger: number,
  ): Promise<number> {
    const result = await query(
      `DELETE FROM indexed_events WHERE ledger >= $1 AND ledger <= $2`,
      [startLedger, endLedger],
    );
    return result.rowCount ?? 0;
  }
}

export class DatabaseService {
  static async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async healthCheck(): Promise<boolean> {
    try {
      const result = await query("SELECT 1");
      return result.rowCount === 1;
    } catch {
      return false;
    }
  }
}
