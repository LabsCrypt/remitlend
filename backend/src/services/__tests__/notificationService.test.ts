import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('twilio', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

jest.unstable_mockModule('@sendgrid/mail', () => ({
  default: { setApiKey: jest.fn(), send: jest.fn() },
}));

const { notificationService } = await import('../notificationService.js');

describe('notificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('sets actionUrl from loanId when not explicitly provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            user_id: 'user1',
            type: 'loan_approved',
            title: 'Loan Approved',
            message: 'Your loan has been approved',
            loan_id: 42,
            action_url: '/loans/42',
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user1',
        type: 'loan_approved',
        title: 'Loan Approved',
        message: 'Your loan has been approved',
        loanId: 42,
      });

      expect(notification.actionUrl).toBe('/loans/42');
      const insertCall = mockQuery.mock.calls[0] as [string, unknown[]];
      expect(insertCall[1]).toContain('/loans/42');
    });

    it('uses explicit actionUrl over loanId when provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            user_id: 'user2',
            type: 'repayment_confirmed',
            title: 'Remittance Sent',
            message: 'Remittance submitted',
            loan_id: null,
            action_url: '/remittances/99',
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user2',
        type: 'repayment_confirmed',
        title: 'Remittance Sent',
        message: 'Remittance submitted',
        actionUrl: '/remittances/99',
      });

      expect(notification.actionUrl).toBe('/remittances/99');
    });

    it('returns null actionUrl when neither loanId nor actionUrl provided', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 3,
            user_id: 'user3',
            type: 'score_changed',
            title: 'Score Changed',
            message: 'Your score changed',
            loan_id: null,
            action_url: null,
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            email: null,
            phone: null,
            email_enabled: false,
            sms_enabled: false,
          },
        ],
        rowCount: 1,
      });

      const notification = await notificationService.createNotification({
        userId: 'user3',
        type: 'score_changed',
        title: 'Score Changed',
        message: 'Your score changed',
      });

      expect(notification.actionUrl).toBeUndefined();
    });
  });

  describe("notifyAdmins", () => {
    const originalAdminWallets = process.env.ADMIN_WALLETS;
    const originalAdminEmail = process.env.ADMIN_EMAIL;

    afterEach(() => {
      if (originalAdminWallets === undefined) {
        delete process.env.ADMIN_WALLETS;
      } else {
        process.env.ADMIN_WALLETS = originalAdminWallets;
      }
      if (originalAdminEmail === undefined) {
        delete process.env.ADMIN_EMAIL;
      } else {
        process.env.ADMIN_EMAIL = originalAdminEmail;
      }
    });

    const makeNotificationRow = (userId: string, loanId: number | null) => ({
      id: 1,
      user_id: userId,
      type: "loan_defaulted",
      title: "Loan Default",
      message: "A loan has defaulted",
      loan_id: loanId,
      action_url: loanId != null ? `/loans/${loanId}` : null,
      read: false,
      status: "unread",
      created_at: new Date("2026-05-28T12:00:00.000Z"),
    });

    it("inserts a notification for each wallet in ADMIN_WALLETS without querying role", async () => {
      process.env.ADMIN_WALLETS = "wallet1,wallet2";
      delete process.env.ADMIN_EMAIL;

      mockQuery
        .mockResolvedValueOnce({
          rows: [makeNotificationRow("wallet1", 99)],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [makeNotificationRow("wallet2", 99)],
          rowCount: 1,
        });

      await notificationService.notifyAdmins({
        title: "Loan Default",
        message: "A loan has defaulted",
        loanId: 99,
      });

      const sqls = (mockQuery.mock.calls as [string, unknown[]][]).map(
        (c) => c[0],
      );
      expect(sqls.some((s) => s.includes("WHERE role"))).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      const params0 = (mockQuery.mock.calls[0]?.[1] ?? []) as unknown[];
      const params1 = (mockQuery.mock.calls[1]?.[1] ?? []) as unknown[];
      expect(params0[0]).toBe("wallet1");
      expect(params1[0]).toBe("wallet2");
    });

    it("does nothing when ADMIN_WALLETS is unset", async () => {
      delete process.env.ADMIN_WALLETS;
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: "Test",
        message: "Test",
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("does nothing when ADMIN_WALLETS is empty or whitespace-only", async () => {
      process.env.ADMIN_WALLETS = " , , ";
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: "Test",
        message: "Test",
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
