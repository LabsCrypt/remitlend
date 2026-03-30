import dotenv from "dotenv";
import { closePool, query } from "../db/connection.js";
import logger from "../utils/logger.js";

dotenv.config();

type NotificationType =
  | "loan_approved"
  | "repayment_due"
  | "repayment_confirmed"
  | "loan_defaulted"
  | "score_changed";

interface DevUser {
  userId: string;
  publicKey: string;
  displayName: string;
  email: string;
  score: number;
  metadata: Record<string, unknown>;
}

interface RemittanceSeed {
  userId: string;
  amount: number;
  month: string;
  status: string;
}

interface LoanHistorySeed {
  loanId: number;
  borrowerPublicKey: string;
  lenderPublicKey: string;
  principalAmount: number;
  interestRateBps: number;
  principalPaid: number;
  interestPaid: number;
  accruedInterest: number;
  status: string;
  requestedAt: Date;
  dueDate: Date;
  approvedAt?: Date;
  repaidAt?: Date;
  defaultedAt?: Date;
  metadata: Record<string, unknown>;
}

interface LoanEventSeed {
  eventId: string;
  eventType: string;
  loanId?: number;
  borrower: string;
  amount?: string;
  ledger: number;
  ledgerClosedAt: Date;
  txHash: string;
  contractId: string;
  topics: unknown[];
  value: string;
  interestRateBps?: number;
  termLedgers?: number;
}

interface NotificationSeed {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  loanId?: number;
  read: boolean;
  createdAt: Date;
}

const NOW = new Date("2026-03-26T12:00:00.000Z");
const CONTRACT_ID =
  "CDDUMMYREMITLENDCONTRACT0000000000000000000000000000000000";
const DEV_LENDER =
  "GDEVLENDERACCOUNT000000000000000000000000000000000000000000";
const ACTIVE_TERM_LEDGERS = 17280;

const devUsers: DevUser[] = [
  {
    userId: "GDEVUSERALICE000000000000000000000000000000000000000000001",
    publicKey: "GDEVUSERALICE000000000000000000000000000000000000000000001",
    displayName: "Alice Remit",
    email: "alice@remitlend.dev",
    score: 782,
    metadata: { role: "borrower", country: "NG", segment: "power-user" },
  },
  {
    userId: "GDEVUSERBOLA000000000000000000000000000000000000000000002",
    publicKey: "GDEVUSERBOLA000000000000000000000000000000000000000000002",
    displayName: "Bola Credit",
    email: "bola@remitlend.dev",
    score: 701,
    metadata: { role: "borrower", country: "GH", segment: "growing" },
  },
  {
    userId: "GDEVUSERCHIDI00000000000000000000000000000000000000000003",
    publicKey: "GDEVUSERCHIDI00000000000000000000000000000000000000000003",
    displayName: "Chidi Default",
    email: "chidi@remitlend.dev",
    score: 611,
    metadata: { role: "borrower", country: "KE", segment: "high-risk" },
  },
  {
    userId: "GDEVUSERDARA000000000000000000000000000000000000000000004",
    publicKey: "GDEVUSERDARA000000000000000000000000000000000000000000004",
    displayName: "Dara Pending",
    email: "dara@remitlend.dev",
    score: 690,
    metadata: { role: "borrower", country: "NG", segment: "new-user" },
  },
  {
    userId: "GDEVUSEREFE0000000000000000000000000000000000000000000005",
    publicKey: "GDEVUSEREFE0000000000000000000000000000000000000000000005",
    displayName: "Efe Lender",
    email: "efe@remitlend.dev",
    score: 820,
    metadata: { role: "lender", country: "ZA", segment: "pool-provider" },
  },
];

const [aliceUser, bolaUser, chidiUser, daraUser] = devUsers as [
  DevUser,
  DevUser,
  DevUser,
  DevUser,
  DevUser,
];

const remittanceHistorySeeds: RemittanceSeed[] = [
  {
    userId: aliceUser.userId,
    amount: 900,
    month: "January",
    status: "Completed",
  },
  {
    userId: aliceUser.userId,
    amount: 950,
    month: "February",
    status: "Completed",
  },
  {
    userId: aliceUser.userId,
    amount: 910,
    month: "March",
    status: "Completed",
  },
  {
    userId: bolaUser.userId,
    amount: 600,
    month: "January",
    status: "Completed",
  },
  { userId: bolaUser.userId, amount: 625, month: "February", status: "Late" },
  { userId: bolaUser.userId, amount: 610, month: "March", status: "Completed" },
  {
    userId: chidiUser.userId,
    amount: 420,
    month: "January",
    status: "Completed",
  },
  {
    userId: chidiUser.userId,
    amount: 400,
    month: "February",
    status: "Missed",
  },
  { userId: chidiUser.userId, amount: 390, month: "March", status: "Late" },
  {
    userId: daraUser.userId,
    amount: 500,
    month: "January",
    status: "Completed",
  },
  { userId: daraUser.userId, amount: 0, month: "February", status: "Pending" },
];

const loanHistorySeeds: LoanHistorySeed[] = [
  {
    loanId: 1001,
    borrowerPublicKey: aliceUser.publicKey,
    lenderPublicKey: DEV_LENDER,
    principalAmount: 1200,
    interestRateBps: 1200,
    principalPaid: 0,
    interestPaid: 0,
    accruedInterest: 18,
    status: "Active",
    requestedAt: new Date("2026-03-20T10:00:00.000Z"),
    approvedAt: new Date("2026-03-20T10:15:00.000Z"),
    dueDate: new Date("2026-03-27T10:15:00.000Z"),
    metadata: { stage: "active", purpose: "inventory restock" },
  },
  {
    loanId: 1002,
    borrowerPublicKey: bolaUser.publicKey,
    lenderPublicKey: DEV_LENDER,
    principalAmount: 800,
    interestRateBps: 900,
    principalPaid: 800,
    interestPaid: 24,
    accruedInterest: 0,
    status: "Repaid",
    requestedAt: new Date("2026-03-12T09:00:00.000Z"),
    approvedAt: new Date("2026-03-12T09:30:00.000Z"),
    repaidAt: new Date("2026-03-18T11:00:00.000Z"),
    dueDate: new Date("2026-03-19T09:30:00.000Z"),
    metadata: { stage: "repaid", purpose: "working capital" },
  },
  {
    loanId: 1003,
    borrowerPublicKey: chidiUser.publicKey,
    lenderPublicKey: DEV_LENDER,
    principalAmount: 650,
    interestRateBps: 1500,
    principalPaid: 200,
    interestPaid: 10,
    accruedInterest: 60,
    status: "Defaulted",
    requestedAt: new Date("2026-03-03T08:00:00.000Z"),
    approvedAt: new Date("2026-03-03T08:25:00.000Z"),
    defaultedAt: new Date("2026-03-16T14:00:00.000Z"),
    dueDate: new Date("2026-03-10T08:25:00.000Z"),
    metadata: { stage: "defaulted", purpose: "emergency remittance" },
  },
  {
    loanId: 1004,
    borrowerPublicKey: daraUser.publicKey,
    lenderPublicKey: DEV_LENDER,
    principalAmount: 500,
    interestRateBps: 1100,
    principalPaid: 0,
    interestPaid: 0,
    accruedInterest: 0,
    status: "Pending",
    requestedAt: new Date("2026-03-25T16:00:00.000Z"),
    dueDate: new Date("2026-04-01T16:00:00.000Z"),
    metadata: { stage: "pending", purpose: "school fees" },
  },
];

const loanEventSeeds: LoanEventSeed[] = [
  {
    eventId: "seed-loan-1001-requested",
    eventType: "LoanRequested",
    loanId: 1001,
    borrower: aliceUser.publicKey,
    amount: "1200",
    ledger: 240100,
    ledgerClosedAt: new Date("2026-03-20T10:00:00.000Z"),
    txHash: "seed-tx-1001-requested",
    contractId: CONTRACT_ID,
    topics: ["LoanRequested", aliceUser.publicKey],
    value: "1200",
  },
  {
    eventId: "seed-loan-1001-approved",
    eventType: "LoanApproved",
    loanId: 1001,
    borrower: aliceUser.publicKey,
    amount: "1200",
    ledger: 240105,
    ledgerClosedAt: new Date("2026-03-20T10:15:00.000Z"),
    txHash: "seed-tx-1001-approved",
    contractId: CONTRACT_ID,
    topics: ["LoanApproved", "1001"],
    value: aliceUser.publicKey,
    interestRateBps: 1200,
    termLedgers: ACTIVE_TERM_LEDGERS,
  },
  {
    eventId: "seed-loan-1002-requested",
    eventType: "LoanRequested",
    loanId: 1002,
    borrower: bolaUser.publicKey,
    amount: "800",
    ledger: 239500,
    ledgerClosedAt: new Date("2026-03-12T09:00:00.000Z"),
    txHash: "seed-tx-1002-requested",
    contractId: CONTRACT_ID,
    topics: ["LoanRequested", bolaUser.publicKey],
    value: "800",
  },
  {
    eventId: "seed-loan-1002-approved",
    eventType: "LoanApproved",
    loanId: 1002,
    borrower: bolaUser.publicKey,
    amount: "800",
    ledger: 239506,
    ledgerClosedAt: new Date("2026-03-12T09:30:00.000Z"),
    txHash: "seed-tx-1002-approved",
    contractId: CONTRACT_ID,
    topics: ["LoanApproved", "1002"],
    value: bolaUser.publicKey,
    interestRateBps: 900,
    termLedgers: ACTIVE_TERM_LEDGERS,
  },
  {
    eventId: "seed-loan-1002-repaid",
    eventType: "LoanRepaid",
    loanId: 1002,
    borrower: bolaUser.publicKey,
    amount: "824",
    ledger: 239900,
    ledgerClosedAt: new Date("2026-03-18T11:00:00.000Z"),
    txHash: "seed-tx-1002-repaid",
    contractId: CONTRACT_ID,
    topics: ["LoanRepaid", bolaUser.publicKey, "1002"],
    value: "824",
  },
  {
    eventId: "seed-loan-1003-requested",
    eventType: "LoanRequested",
    loanId: 1003,
    borrower: chidiUser.publicKey,
    amount: "650",
    ledger: 238200,
    ledgerClosedAt: new Date("2026-03-03T08:00:00.000Z"),
    txHash: "seed-tx-1003-requested",
    contractId: CONTRACT_ID,
    topics: ["LoanRequested", chidiUser.publicKey],
    value: "650",
  },
  {
    eventId: "seed-loan-1003-approved",
    eventType: "LoanApproved",
    loanId: 1003,
    borrower: chidiUser.publicKey,
    amount: "650",
    ledger: 238205,
    ledgerClosedAt: new Date("2026-03-03T08:25:00.000Z"),
    txHash: "seed-tx-1003-approved",
    contractId: CONTRACT_ID,
    topics: ["LoanApproved", "1003"],
    value: chidiUser.publicKey,
    interestRateBps: 1500,
    termLedgers: ACTIVE_TERM_LEDGERS,
  },
  {
    eventId: "seed-loan-1003-repaid-partial",
    eventType: "LoanRepaid",
    loanId: 1003,
    borrower: chidiUser.publicKey,
    amount: "210",
    ledger: 238600,
    ledgerClosedAt: new Date("2026-03-08T10:00:00.000Z"),
    txHash: "seed-tx-1003-repaid-partial",
    contractId: CONTRACT_ID,
    topics: ["LoanRepaid", chidiUser.publicKey, "1003"],
    value: "210",
  },
  {
    eventId: "seed-loan-1003-defaulted",
    eventType: "LoanDefaulted",
    loanId: 1003,
    borrower: chidiUser.publicKey,
    ledger: 239100,
    ledgerClosedAt: new Date("2026-03-16T14:00:00.000Z"),
    txHash: "seed-tx-1003-defaulted",
    contractId: CONTRACT_ID,
    topics: ["LoanDefaulted", "1003"],
    value: chidiUser.publicKey,
  },
  {
    eventId: "seed-loan-1004-requested",
    eventType: "LoanRequested",
    loanId: 1004,
    borrower: daraUser.publicKey,
    amount: "500",
    ledger: 240990,
    ledgerClosedAt: new Date("2026-03-25T16:00:00.000Z"),
    txHash: "seed-tx-1004-requested",
    contractId: CONTRACT_ID,
    topics: ["LoanRequested", daraUser.publicKey],
    value: "500",
  },
];

const notificationSeeds: NotificationSeed[] = [
  {
    userId: aliceUser.userId,
    type: "repayment_due",
    title: "Repayment Due Soon",
    message: "Loan #1001 repayment window closes tomorrow.",
    loanId: 1001,
    read: false,
    createdAt: new Date("2026-03-25T12:00:00.000Z"),
  },
  {
    userId: bolaUser.userId,
    type: "loan_approved",
    title: "Loan Approved",
    message: "Your loan #1002 is funded and ready for use.",
    loanId: 1002,
    read: true,
    createdAt: new Date("2026-03-12T09:35:00.000Z"),
  },
  {
    userId: bolaUser.userId,
    type: "repayment_confirmed",
    title: "Repayment Confirmed",
    message: "Loan #1002 has been fully repaid.",
    loanId: 1002,
    read: false,
    createdAt: new Date("2026-03-18T11:05:00.000Z"),
  },
  {
    userId: chidiUser.userId,
    type: "loan_defaulted",
    title: "Loan Defaulted",
    message:
      "Loan #1003 has been marked defaulted after missed repayment windows.",
    loanId: 1003,
    read: false,
    createdAt: new Date("2026-03-16T14:05:00.000Z"),
  },
  {
    userId: chidiUser.userId,
    type: "score_changed",
    title: "Credit Score Updated",
    message: "Your borrower score was adjusted after recent loan activity.",
    loanId: 1003,
    read: true,
    createdAt: new Date("2026-03-16T14:10:00.000Z"),
  },
];

const parseArgs = () => {
  const args = new Set(process.argv.slice(2));
  return {
    reset: args.has("--reset"),
  };
};

const seedUserProfiles = async () => {
  logger.info("Seeding user_profiles...");

  for (const user of devUsers) {
    await query(
      `INSERT INTO user_profiles (public_key, display_name, email, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (public_key)
       DO UPDATE SET
         display_name = EXCLUDED.display_name,
         email = EXCLUDED.email,
         metadata = EXCLUDED.metadata,
         updated_at = CURRENT_TIMESTAMP`,
      [user.publicKey, user.displayName, user.email, user.metadata],
    );
  }
};

const seedScores = async () => {
  logger.info("Seeding scores...");

  for (const user of devUsers) {
    await query(
      `INSERT INTO scores (user_id, current_score, created_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id)
       DO UPDATE SET
         current_score = EXCLUDED.current_score,
         updated_at = CURRENT_TIMESTAMP`,
      [user.userId, user.score, NOW],
    );
  }
};

const seedRemittanceHistory = async () => {
  logger.info("Seeding remittance_history...");

  for (const remittance of remittanceHistorySeeds) {
    const existing = await query(
      `SELECT id
       FROM remittance_history
       WHERE user_id = $1 AND month = $2`,
      [remittance.userId, remittance.month],
    );

    if ((existing.rowCount ?? 0) > 0) {
      await query(
        `UPDATE remittance_history
         SET amount = $3, status = $4
         WHERE user_id = $1 AND month = $2`,
        [
          remittance.userId,
          remittance.month,
          remittance.amount,
          remittance.status,
        ],
      );
      continue;
    }

    await query(
      `INSERT INTO remittance_history (user_id, amount, month, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        remittance.userId,
        remittance.amount,
        remittance.month,
        remittance.status,
        NOW,
      ],
    );
  }
};

const seedLoanHistory = async () => {
  logger.info("Seeding loan_history...");

  for (const loan of loanHistorySeeds) {
    const existing = await query(
      `SELECT id FROM loan_history WHERE loan_id = $1`,
      [loan.loanId],
    );

    if ((existing.rowCount ?? 0) > 0) {
      await query(
        `UPDATE loan_history
         SET borrower_public_key = $2,
             lender_public_key = $3,
             principal_amount = $4,
             interest_rate_bps = $5,
             principal_paid = $6,
             interest_paid = $7,
             accrued_interest = $8,
             status = $9,
             due_date = $10,
             requested_at = $11,
             approved_at = $12,
             repaid_at = $13,
             defaulted_at = $14,
             metadata = $15,
             updated_at = CURRENT_TIMESTAMP
         WHERE loan_id = $1`,
        [
          loan.loanId,
          loan.borrowerPublicKey,
          loan.lenderPublicKey,
          loan.principalAmount,
          loan.interestRateBps,
          loan.principalPaid,
          loan.interestPaid,
          loan.accruedInterest,
          loan.status,
          loan.dueDate,
          loan.requestedAt,
          loan.approvedAt ?? null,
          loan.repaidAt ?? null,
          loan.defaultedAt ?? null,
          loan.metadata,
        ],
      );
      continue;
    }

    await query(
      `INSERT INTO loan_history (
         loan_id,
         borrower_public_key,
         lender_public_key,
         principal_amount,
         interest_rate_bps,
         principal_paid,
         interest_paid,
         accrued_interest,
         status,
         due_date,
         requested_at,
         approved_at,
         repaid_at,
         defaulted_at,
         metadata,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
      [
        loan.loanId,
        loan.borrowerPublicKey,
        loan.lenderPublicKey,
        loan.principalAmount,
        loan.interestRateBps,
        loan.principalPaid,
        loan.interestPaid,
        loan.accruedInterest,
        loan.status,
        loan.dueDate,
        loan.requestedAt,
        loan.approvedAt ?? null,
        loan.repaidAt ?? null,
        loan.defaultedAt ?? null,
        loan.metadata,
        NOW,
      ],
    );
  }
};

const seedLoanEvents = async () => {
  logger.info("Seeding loan_events...");

  for (const event of loanEventSeeds) {
    await query(
      `INSERT INTO loan_events (
         event_id,
         event_type,
         loan_id,
         borrower,
         amount,
         ledger,
         ledger_closed_at,
         tx_hash,
         contract_id,
         topics,
         value,
         interest_rate_bps,
         term_ledgers,
         created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14)
       ON CONFLICT (event_id)
       DO UPDATE SET
         event_type = EXCLUDED.event_type,
         loan_id = EXCLUDED.loan_id,
         borrower = EXCLUDED.borrower,
         amount = EXCLUDED.amount,
         ledger = EXCLUDED.ledger,
         ledger_closed_at = EXCLUDED.ledger_closed_at,
         tx_hash = EXCLUDED.tx_hash,
         contract_id = EXCLUDED.contract_id,
         topics = EXCLUDED.topics,
         value = EXCLUDED.value,
         interest_rate_bps = EXCLUDED.interest_rate_bps,
         term_ledgers = EXCLUDED.term_ledgers`,
      [
        event.eventId,
        event.eventType,
        event.loanId ?? null,
        event.borrower,
        event.amount ?? null,
        event.ledger,
        event.ledgerClosedAt,
        event.txHash,
        event.contractId,
        JSON.stringify(event.topics),
        event.value,
        event.interestRateBps ?? null,
        event.termLedgers ?? null,
        NOW,
      ],
    );
  }
};

const seedNotifications = async () => {
  logger.info("Seeding notifications...");

  for (const notification of notificationSeeds) {
    const existing = await query(
      `SELECT id
       FROM notifications
       WHERE user_id = $1
         AND type = $2
         AND title = $3
         AND message = $4
         AND COALESCE(loan_id, -1) = COALESCE($5, -1)`,
      [
        notification.userId,
        notification.type,
        notification.title,
        notification.message,
        notification.loanId ?? null,
      ],
    );

    if ((existing.rowCount ?? 0) > 0) {
      await query(
        `UPDATE notifications
         SET read = $6, created_at = $7
         WHERE user_id = $1
           AND type = $2
           AND title = $3
           AND message = $4
           AND COALESCE(loan_id, -1) = COALESCE($5, -1)`,
        [
          notification.userId,
          notification.type,
          notification.title,
          notification.message,
          notification.loanId ?? null,
          notification.read,
          notification.createdAt,
        ],
      );
      continue;
    }

    await query(
      `INSERT INTO notifications (user_id, type, title, message, loan_id, read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        notification.userId,
        notification.type,
        notification.title,
        notification.message,
        notification.loanId ?? null,
        notification.read,
        notification.createdAt,
      ],
    );
  }
};

const seedIndexerState = async () => {
  logger.info("Updating indexer_state...");

  const lastSeededLedger = Math.max(
    ...loanEventSeeds.map((event) => event.ledger),
  );
  const existing = await query(
    `SELECT id FROM indexer_state ORDER BY id DESC LIMIT 1`,
  );

  if ((existing.rowCount ?? 0) > 0) {
    await query(
      `UPDATE indexer_state
       SET last_indexed_ledger = $1,
           last_indexed_cursor = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = (SELECT id FROM indexer_state ORDER BY id DESC LIMIT 1)`,
      [lastSeededLedger, "seeded-dev-data"],
    );
    return;
  }

  await query(
    `INSERT INTO indexer_state (last_indexed_ledger, last_indexed_cursor, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)`,
    [lastSeededLedger, "seeded-dev-data"],
  );
};

const resetDevelopmentData = async () => {
  logger.info("Resetting development seed data...");

  await query(
    `TRUNCATE TABLE
       notifications,
       loan_events,
       loan_history,
       remittance_history,
       scores,
       user_profiles
     RESTART IDENTITY`,
  );

  await query(
    `UPDATE indexer_state
     SET last_indexed_ledger = 0,
         last_indexed_cursor = NULL,
         updated_at = CURRENT_TIMESTAMP`,
  );
};

const logSummary = () => {
  logger.info("Development data summary", {
    users: devUsers.length,
    remittances: remittanceHistorySeeds.length,
    loanHistory: loanHistorySeeds.length,
    loanEvents: loanEventSeeds.length,
    notifications: notificationSeeds.length,
  });
};

const runSeed = async () => {
  const { reset } = parseArgs();

  logger.info("Starting development database seeding...");
  logger.info("=".repeat(50));

  try {
    await query("BEGIN");

    if (reset) {
      await resetDevelopmentData();
    }

    await seedUserProfiles();
    await seedScores();
    await seedRemittanceHistory();
    await seedLoanHistory();
    await seedLoanEvents();
    await seedNotifications();
    await seedIndexerState();

    await query("COMMIT");

    logger.info("");
    logger.info("=".repeat(50));
    logger.info("Development database seeding completed successfully!");
    logSummary();
  } catch (error) {
    await query("ROLLBACK").catch(() => undefined);
    logger.error("Error during development seeding", {
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack && { stack: error.stack }),
    });
    process.exit(1);
  } finally {
    await closePool();
  }
};

runSeed();
