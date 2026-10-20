import request from 'supertest';
import { jest } from '@jest/globals';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

const fakeCacheStore = new Map<string, unknown>();
await jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

await jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn(async (key: string) => fakeCacheStore.get(key) ?? null),
    set: jest.fn(async (key: string, value: unknown) => {
      fakeCacheStore.set(key, value);
    }),
    delete: jest.fn(async (key: string) => {
      fakeCacheStore.delete(key);
    }),
    ping: jest.fn(async () => 'ok'),
  },
}));

await jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

await import('../db/connection.js');
const { default: app } = await import('../app.js');
const { generateJwtToken } = await import('../services/authService.js');
const { notificationService } = await import('../services/notificationService.js');
const { default: logger } = await import('../utils/logger.js');

const bearer = (publicKey: string) => ({
  Authorization: `Bearer ${generateJwtToken(publicKey)}`,
});

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

afterAll(() => {
  delete process.env.JWT_SECRET;
});

describe('notification preferences endpoints', () => {
  it('returns empty defaults when no profile row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const response = await request(app)
      .get('/api/notifications/preferences')
      .set(bearer('GTESTUSER1111111111111111111111111111111111111111111111111'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      emailEnabled: false,
      smsEnabled: false,
      phone: null,
      perTypeOverrides: {},
    });
  });

  it('returns persisted perTypeOverrides on GET', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email_enabled: true,
          sms_enabled: false,
          phone: '+15551234567',
          per_type_overrides: { repayment_due: true, loan_approved: false },
        },
      ],
    });

    const response = await request(app)
      .get('/api/notifications/preferences')
      .set(bearer('GTESTUSER5555555555555555555555555555555555555555555555555'));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      emailEnabled: true,
      smsEnabled: false,
      phone: '+15551234567',
      perTypeOverrides: { repayment_due: true, loan_approved: false },
    });
  });

  it('writes valid preferences and returns updated payload', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_enabled: true, sms_enabled: true, phone: '+14155552671' }],
    });
    // Mock for upsert into user_notification_preferences
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const response = await request(app)
      .put('/api/notifications/preferences')
      .set(bearer('GTESTUSER2222222222222222222222222222222222222222222222222'))
      .send({
        emailEnabled: true,
        smsEnabled: true,
        phone: '+14155552671',
        perTypeOverrides: { repayment_due: true },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      emailEnabled: true,
      smsEnabled: true,
      phone: '+14155552671',
      perTypeOverrides: { repayment_due: true },
    });
  });

  it('returns 400 when phone format is invalid', async () => {
    const response = await request(app)
      .put('/api/notifications/preferences')
      .set(bearer('GTESTUSER3333333333333333333333333333333333333333333333333'))
      .send({
        emailEnabled: true,
        smsEnabled: true,
        phone: 'invalid-phone',
        perTypeOverrides: {},
      });

    expect(response.status).toBe(400);
  });

  it('returns 400 when sms is enabled without a phone number', async () => {
    const response = await request(app)
      .put('/api/notifications/preferences')
      .set(bearer('GTESTUSER4444444444444444444444444444444444444444444444444'))
      .send({
        emailEnabled: true,
        smsEnabled: true,
        phone: '',
        perTypeOverrides: {},
      });

    expect(response.status).toBe(400);
  });
});

describe('updateNotificationPreferences upsert', () => {
  it('upserts into user_profiles so settings persist when no profile row exists', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ email_enabled: true, sms_enabled: false, phone: null }],
      rowCount: 1,
    });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await notificationService.updateNotificationPreferences('GNEWUSER', {
      emailEnabled: true,
      smsEnabled: false,
      phone: null,
      perTypeOverrides: {},
    });

    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO user_profiles/);
    expect(sql).toMatch(/ON CONFLICT \(public_key\) DO UPDATE/);
    expect(params).toEqual(['GNEWUSER', true, false, null]);
    expect(result.emailEnabled).toBe(true);
  });
});

describe('notifyUserExternal per-type overrides', () => {
  const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  beforeEach(() => {
    delete process.env.FROM_EMAIL;
    jest.spyOn(logger, 'withContext').mockReturnValue(mockLogger as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const notificationRow = {
    id: 1,
    user_id: 'GUSER',
    type: 'loan_approved',
    title: 't',
    message: 'm',
    loan_id: null,
    action_url: null,
    read: false,
    status: 'unread',
    created_at: new Date(),
  };

  const create = (type: 'loan_approved' | 'repayment_due') =>
    notificationService.createNotification({
      userId: 'GUSER',
      type,
      title: 't',
      message: 'm',
    });

  it('joins user_notification_preferences and skips delivery when the type is opted out', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [notificationRow] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: 'a@b.co',
          phone: null,
          email_enabled: true,
          sms_enabled: false,
          per_type_overrides: { loan_approved: false },
        },
      ],
    });

    await create('loan_approved');

    expect(mockQuery.mock.calls[1]![0]).toMatch(/LEFT JOIN user_notification_preferences/);
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.stringContaining('[Email]'),
      expect.anything(),
    );
  });

  it('still delivers types that are not opted out', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [notificationRow] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          email: 'a@b.co',
          phone: null,
          email_enabled: true,
          sms_enabled: false,
          per_type_overrides: { repayment_due: false },
        },
      ],
    });

    await create('loan_approved');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('[Email]'),
      expect.anything(),
    );
  });
});
