import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

type QueryResult = { rows: Record<string, unknown>[]; rowCount: number };
const mockQuery = jest.fn<(sql: string, params?: unknown[]) => Promise<QueryResult>>();

jest.unstable_mockModule('../../db/connection.js', () => ({
  query: mockQuery,
}));

jest.unstable_mockModule('twilio', () => ({
  default: jest.fn(() => ({ messages: { create: jest.fn() } })),
}));

const mockSendGridSend = jest.fn();

jest.unstable_mockModule('@sendgrid/mail', () => ({
  default: { setApiKey: jest.fn(), send: mockSendGridSend },
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

  describe('email HTML escaping', () => {
    const originalFromEmail = process.env.FROM_EMAIL;
    const originalSendGridKey = process.env.SENDGRID_API_KEY;

    beforeEach(() => {
      process.env.FROM_EMAIL = 'noreply@remitlend.com';
      process.env.SENDGRID_API_KEY = 'test-key';
    });

    afterEach(() => {
      if (originalFromEmail === undefined) {
        delete process.env.FROM_EMAIL;
      } else {
        process.env.FROM_EMAIL = originalFromEmail;
      }
      if (originalSendGridKey === undefined) {
        delete process.env.SENDGRID_API_KEY;
      } else {
        process.env.SENDGRID_API_KEY = originalSendGridKey;
      }
    });

    it('escapes HTML in message before embedding in email body', async () => {
      const maliciousMessage =
        'Your dispute has been resolved: <script>alert("xss")</script><img src=x onerror=alert(1)>';

      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              user_id: 'user1',
              type: 'loan_defaulted',
              title: 'Dispute resolved',
              message: maliciousMessage,
              loan_id: 42,
              action_url: '/loans/42',
              read: false,
              status: 'unread',
              created_at: new Date('2026-05-28T12:00:00.000Z'),
            },
          ],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [
            {
              email: 'borrower@example.com',
              phone: null,
              email_enabled: true,
              sms_enabled: false,
            },
          ],
          rowCount: 1,
        });

      await notificationService.createNotification({
        userId: 'user1',
        type: 'loan_defaulted',
        title: 'Dispute resolved',
        message: maliciousMessage,
        loanId: 42,
      });

      expect(mockSendGridSend).toHaveBeenCalledTimes(1);
      const sendArg = mockSendGridSend.mock.calls[0]?.[0] as { html: string };
      expect(sendArg.html).not.toContain('<script>');
      expect(sendArg.html).not.toContain('<img');
      expect(sendArg.html).toContain('&lt;script&gt;');
      expect(sendArg.html).toContain('&lt;img');
    });

    it('escapes HTML in notifyAdmins email', async () => {
      process.env.ADMIN_EMAIL = 'admin@remitlend.com';
      delete process.env.ADMIN_WALLETS;

      const maliciousMessage =
        'Dispute resolved: <b>confirmed</b><a href="http://evil.com">click</a>';

      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            user_id: 'admin1',
            type: 'dispute_contested',
            title: 'Loan Default Contested',
            message: maliciousMessage,
            loan_id: null,
            action_url: null,
            read: false,
            status: 'unread',
            created_at: new Date('2026-05-28T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      });

      await notificationService.notifyAdmins({
        title: 'Loan Default',
        message: maliciousMessage,
      });

      expect(mockSendGridSend).toHaveBeenCalledTimes(1);
      const sendArg = mockSendGridSend.mock.calls[0]?.[0] as { html: string };
      expect(sendArg.html).not.toContain('<b>');
      expect(sendArg.html).not.toContain('<a ');
      expect(sendArg.html).toContain('&lt;b&gt;');
      expect(sendArg.html).toContain('&lt;a ');
    });
  });

  describe('notifyAdmins', () => {
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
      type: 'dispute_contested',
      title: 'Loan Default Contested',
      message: 'A borrower has contested a loan default',
      loan_id: loanId,
      action_url: loanId != null ? `/loans/${loanId}` : null,
      read: false,
      status: 'unread',
      created_at: new Date('2026-05-28T12:00:00.000Z'),
    });

    it('inserts a notification for each wallet in ADMIN_WALLETS without querying role', async () => {
      process.env.ADMIN_WALLETS = 'wallet1,wallet2';
      delete process.env.ADMIN_EMAIL;

      mockQuery
        .mockResolvedValueOnce({
          rows: [makeNotificationRow('wallet1', 99)],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [makeNotificationRow('wallet2', 99)],
          rowCount: 1,
        });

      await notificationService.notifyAdmins({
        title: 'Loan Default',
        message: 'A loan has defaulted',
        loanId: 99,
      });

      const sqls = (mockQuery.mock.calls as [string, unknown[]][]).map((c) => c[0]);
      expect(sqls.some((s) => s.includes('WHERE role'))).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(2);

      const params0 = (mockQuery.mock.calls[0]?.[1] ?? []) as unknown[];
      const params1 = (mockQuery.mock.calls[1]?.[1] ?? []) as unknown[];
      expect(params0[0]).toBe('wallet1');
      expect(params1[0]).toBe('wallet2');
      expect(params0[1]).toBe('dispute_contested');
      expect(params1[1]).toBe('dispute_contested');
    });

    it('does nothing when ADMIN_WALLETS is unset', async () => {
      delete process.env.ADMIN_WALLETS;
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: 'Test',
        message: 'Test',
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does nothing when ADMIN_WALLETS is empty or whitespace-only', async () => {
      process.env.ADMIN_WALLETS = ' , , ';
      delete process.env.ADMIN_EMAIL;

      await notificationService.notifyAdmins({
        title: 'Test',
        message: 'Test',
      });

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
});
