import { query } from '../db/connection.js';

export interface UserProfile {
  id: number;
  public_key: string;
  display_name: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown> | null;
}

export interface LoanHistory {
  id: number;
  loan_id: number;
  borrower_public_key: string;
  lender_public_key: string | null;
  principal_amount: number;
  interest_rate_bps: number;
  principal_paid: number;
  interest_paid: number;
  accrued_interest: number;
  status: string;
  due_date: Date | null;
  requested_at: Date | null;
  approved_at: Date | null;
  repaid_at: Date | null;
  defaulted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown> | null;
}

export interface IndexedEvent {
  id: number;
  event_id: string;
  event_type: string;
  contract_id: string;
  tx_hash: string;
  ledger: number;
  ledger_closed_at: Date;
  topics: unknown[] | null;
  value: string | null;
  processed: boolean;
  created_at: Date;
  updated_at: Date;
}

export const UserProfileService = {
  async create(data: {
    public_key: string;
    display_name?: string;
    email?: string;
    metadata?: Record<string, unknown>;
  }): Promise<UserProfile> {
    const result = await query(
      `INSERT INTO user_profiles (public_key, display_name, email, metadata)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.public_key, data.display_name ?? null, data.email ?? null, data.metadata ?? null],
    );
    return result.rows[0] as UserProfile;
  },

  async findByPublicKey(publicKey: string): Promise<UserProfile | null> {
    const result = await query('SELECT * FROM user_profiles WHERE public_key = $1', [publicKey]);
    return (result.rows[0] as UserProfile) ?? null;
  },

  async update(
    publicKey: string,
    data: Partial<Omit<UserProfile, 'id' | 'public_key' | 'created_at' | 'updated_at'>>,
  ): Promise<UserProfile | null> {
    const fields = Object.keys(data);
    if (fields.length === 0) return this.findByPublicKey(publicKey);

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map((f) => (data as Record<string, unknown>)[f]);

    const result = await query(
      `UPDATE user_profiles SET ${setClauses}, updated_at = NOW()
       WHERE public_key = $1
       RETURNING *`,
      [publicKey, ...values],
    );
    return (result.rows[0] as UserProfile) ?? null;
  },

  async upsert(data: {
    public_key: string;
    display_name?: string;
    email?: string;
    metadata?: Record<string, unknown>;
  }): Promise<UserProfile> {
    const result = await query(
      `INSERT INTO user_profiles (public_key, display_name, email, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (public_key) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             email = EXCLUDED.email,
             metadata = EXCLUDED.metadata,
             updated_at = NOW()
       RETURNING *`,
      [data.public_key, data.display_name ?? null, data.email ?? null, data.metadata ?? null],
    );
    return result.rows[0] as UserProfile;
  },

  async delete(publicKey: string): Promise<boolean> {
    const result = await query('DELETE FROM user_profiles WHERE public_key = $1', [publicKey]);
    return (result.rowCount ?? 0) > 0;
  },
};

export const LoanHistoryService = {
  async create(data: {
    loan_id: number;
    borrower_public_key: string;
    lender_public_key?: string;
    principal_amount: number;
    interest_rate_bps: number;
    status: string;
    due_date?: Date;
    requested_at?: Date;
    metadata?: Record<string, unknown>;
  }): Promise<LoanHistory> {
    const result = await query(
      `INSERT INTO loan_history
         (loan_id, borrower_public_key, lender_public_key, principal_amount,
          interest_rate_bps, status, due_date, requested_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.loan_id,
        data.borrower_public_key,
        data.lender_public_key ?? null,
        data.principal_amount,
        data.interest_rate_bps,
        data.status,
        data.due_date ?? null,
        data.requested_at ?? null,
        data.metadata ?? null,
      ],
    );
    return result.rows[0] as LoanHistory;
  },

  async findByBorrower(borrowerPublicKey: string): Promise<LoanHistory[]> {
    const result = await query(
      'SELECT * FROM loan_history WHERE borrower_public_key = $1 ORDER BY created_at DESC',
      [borrowerPublicKey],
    );
    return result.rows as LoanHistory[];
  },

  async update(
    loanId: number,
    data: Partial<
      Omit<LoanHistory, 'id' | 'loan_id' | 'borrower_public_key' | 'created_at' | 'updated_at'>
    >,
  ): Promise<LoanHistory | null> {
    const fields = Object.keys(data);
    if (fields.length === 0) {
      const r = await query('SELECT * FROM loan_history WHERE loan_id = $1', [loanId]);
      return (r.rows[0] as LoanHistory) ?? null;
    }

    const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    const values = fields.map((f) => (data as Record<string, unknown>)[f]);

    const result = await query(
      `UPDATE loan_history SET ${setClauses}, updated_at = NOW()
       WHERE loan_id = $1
       RETURNING *`,
      [loanId, ...values],
    );
    return (result.rows[0] as LoanHistory) ?? null;
  },
};

export const IndexedEventsService = {
  async create(data: {
    event_id: string;
    event_type: string;
    contract_id: string;
    tx_hash: string;
    ledger: number;
    ledger_closed_at: Date;
    topics?: unknown[];
    value?: string;
  }): Promise<IndexedEvent | null> {
    try {
      const result = await query(
        `INSERT INTO indexed_events
           (event_id, event_type, contract_id, tx_hash, ledger, ledger_closed_at, topics, value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING *`,
        [
          data.event_id,
          data.event_type,
          data.contract_id,
          data.tx_hash,
          data.ledger,
          data.ledger_closed_at,
          data.topics ?? null,
          data.value ?? null,
        ],
      );
      return (result.rows[0] as IndexedEvent) ?? null;
    } catch {
      return null;
    }
  },

  async findUnprocessed(): Promise<IndexedEvent[]> {
    const result = await query(
      'SELECT * FROM indexed_events WHERE processed = false ORDER BY ledger ASC',
    );
    return result.rows as IndexedEvent[];
  },

  async markProcessed(eventId: string): Promise<boolean> {
    const result = await query(
      'UPDATE indexed_events SET processed = true, updated_at = NOW() WHERE event_id = $1',
      [eventId],
    );
    return (result.rowCount ?? 0) > 0;
  },

  async findByTxHash(txHash: string): Promise<IndexedEvent[]> {
    const result = await query('SELECT * FROM indexed_events WHERE tx_hash = $1', [txHash]);
    return result.rows as IndexedEvent[];
  },
};

export const DatabaseService = {
  async healthCheck(): Promise<boolean> {
    try {
      await query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  },
};
