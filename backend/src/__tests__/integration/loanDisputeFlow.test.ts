process.env.JWT_SECRET = "test-secret";
process.env.INTERNAL_API_KEY = "test-api-key";
process.env.NODE_ENV = "test";

import { jest } from "@jest/globals";

const mockQuery: any = jest.fn();
const mockNotifyAdmins = jest.fn();
const mockCreateNotification = jest.fn();

jest.unstable_mockModule("../../db/connection.js", () => ({
  query: mockQuery,
  default: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  withTransaction: jest.fn(),
}));
jest.unstable_mockModule("../../db/transaction.js", () => ({
  withTransaction: jest.fn(),
  withStellarAndDbTransaction: jest.fn(),
}));
jest.unstable_mockModule("../../services/notificationService.js", () => ({
  notificationService: {
    notifyAdmins: mockNotifyAdmins,
    createNotification: mockCreateNotification,
  },
}));

let request: typeof import("supertest");
let jwt: typeof import("jsonwebtoken");
let app: any;

const TEST_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const ADMIN_API_KEY = "test-api-key";
const LOAN_ID = 42;
const DISPUTE_ID = 7;

function mintToken(publicKey = TEST_PUBLIC_KEY) {
  return jwt.sign(
    { publicKey, role: "borrower", scopes: ["read:loans", "write:loans"] },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

function dbRows(rows: object[], command = "SELECT") {
  return { rows, rowCount: rows.length, command, oid: 0, fields: [] } as any;
}

function dbOk(command = "INSERT") {
  return { rows: [], rowCount: 1, command, oid: 0, fields: [] } as any;
}

async function seedDefaultedLoan(authToken: string) {
  mockQuery
    .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
    .mockResolvedValueOnce(dbOk())
    .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }]))
    .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
    .mockResolvedValueOnce(dbOk());

  const loanRes = await request(app)
    .post("/api/loans")
    .set("Authorization", `Bearer ${authToken}`)
    .send({ amount: 1000, term: 12 });

  expect(loanRes.status).toBe(200);

  const defaultRes = await request(app)
    .post(`/api/loans/${LOAN_ID}/mark-defaulted`)
    .set("Authorization", `Bearer ${authToken}`)
    .send({ borrower: TEST_PUBLIC_KEY });

  expect(defaultRes.status).toBe(200);
}

beforeAll(async () => {
  ({ default: request } = await import("supertest"));
  ({ default: jwt } = await import("jsonwebtoken"));
  ({ default: app } = await import("../../app.js"));
});

beforeEach(() => {
  mockQuery.mockReset();
  mockNotifyAdmins.mockReset();
  mockCreateNotification.mockReset();
  mockNotifyAdmins.mockResolvedValue(undefined);
  mockCreateNotification.mockResolvedValue({
    id: 1,
    userId: TEST_PUBLIC_KEY,
    type: "loan_defaulted",
    title: "Dispute resolved",
    message: "ok",
    loanId: LOAN_ID,
    read: false,
    status: "unread",
    createdAt: new Date(),
  });
});

describe("loan dispute resolution integration flow", () => {
  it("contests a defaulted loan and confirms the default with borrower notification", async () => {
    const authToken = mintToken();
    await seedDefaultedLoan(authToken);

    mockQuery
      .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }]))
      .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
      .mockResolvedValueOnce(dbRows([{ id: DISPUTE_ID }]))
      .mockResolvedValueOnce(dbOk());

    const contestRes = await request(app)
      .post(`/api/loans/${LOAN_ID}/contest-default`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ reason: "Indexer lag caused an incorrect default event." });

    expect(contestRes.status).toBe(200);
    expect(contestRes.body.success).toBe(true);
    expect(mockNotifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Loan Default Contested",
        loanId: LOAN_ID,
      }),
    );

    mockQuery
      .mockResolvedValueOnce(
        dbRows([
          {
            id: DISPUTE_ID,
            loan_id: LOAN_ID,
            borrower: TEST_PUBLIC_KEY,
            status: "open",
          },
        ]),
      )
      .mockResolvedValueOnce(dbOk("UPDATE"))
      .mockResolvedValueOnce(dbOk());

    const resolveRes = await request(app)
      .post(`/api/admin/loan-disputes/${DISPUTE_ID}/resolve`)
      .set("x-api-key", ADMIN_API_KEY)
      .send({
        action: "confirm",
        resolution: "Default was valid after ledger review.",
        adminNote: "Collateral ratio stayed below threshold.",
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.success).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_PUBLIC_KEY,
        type: "loan_defaulted",
        loanId: LOAN_ID,
      }),
    );

    expect(mockQuery.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining("INSERT INTO loan_disputes"),
          [String(LOAN_ID), TEST_PUBLIC_KEY, "Indexer lag caused an incorrect default event."],
        ],
        [
          expect.stringContaining("UPDATE loan_disputes SET status = 'resolved'"),
          [
            "Default was valid after ledger review.",
            "Collateral ratio stayed below threshold.",
            String(DISPUTE_ID),
          ],
        ],
        [
          expect.stringContaining("DefaultConfirmed"),
          [LOAN_ID, TEST_PUBLIC_KEY],
        ],
      ]),
    );
  });

  it("contests a defaulted loan and reverses the default with repayment notification", async () => {
    const authToken = mintToken();
    await seedDefaultedLoan(authToken);

    mockQuery
      .mockResolvedValueOnce(dbRows([{ address: TEST_PUBLIC_KEY }]))
      .mockResolvedValueOnce(dbRows([{ loan_id: LOAN_ID }]))
      .mockResolvedValueOnce(dbRows([{ id: DISPUTE_ID }]))
      .mockResolvedValueOnce(dbOk());

    const contestRes = await request(app)
      .post(`/api/loans/${LOAN_ID}/contest-default`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ reason: "The repayment posted before the indexer caught up." });

    expect(contestRes.status).toBe(200);
    expect(contestRes.body.success).toBe(true);
    expect(mockNotifyAdmins).toHaveBeenCalledTimes(1);

    mockQuery
      .mockResolvedValueOnce(
        dbRows([
          {
            id: DISPUTE_ID,
            loan_id: LOAN_ID,
            borrower: TEST_PUBLIC_KEY,
            status: "open",
          },
        ]),
      )
      .mockResolvedValueOnce(dbOk("UPDATE"))
      .mockResolvedValueOnce(dbOk());

    const resolveRes = await request(app)
      .post(`/api/admin/loan-disputes/${DISPUTE_ID}/resolve`)
      .set("x-api-key", ADMIN_API_KEY)
      .send({
        action: "reverse",
        resolution: "Default reversed after repayment verification.",
        adminNote: "Loan events were replayed successfully.",
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.success).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEST_PUBLIC_KEY,
        type: "repayment_confirmed",
        loanId: LOAN_ID,
      }),
    );

    expect(mockQuery.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.stringContaining("INSERT INTO loan_disputes"),
          [String(LOAN_ID), TEST_PUBLIC_KEY, "The repayment posted before the indexer caught up."],
        ],
        [
          expect.stringContaining("UPDATE loan_disputes SET status = 'resolved'"),
          [
            "Default reversed after repayment verification.",
            "Loan events were replayed successfully.",
            String(DISPUTE_ID),
          ],
        ],
        [
          expect.stringContaining("DefaultReversed"),
          [LOAN_ID, TEST_PUBLIC_KEY],
        ],
      ]),
    );
  });
});
