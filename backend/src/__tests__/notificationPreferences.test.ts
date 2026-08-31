import request from 'supertest';
import { jest } from '@jest/globals';
import { generateJwtToken } from '../services/authService.js';

type MockQueryResult = { rows: unknown[]; rowCount?: number };

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';

const mockQuery: jest.MockedFunction<
  (text: string, params?: unknown[]) => Promise<MockQueryResult>
> = jest.fn();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../services/cacheService.js', () => ({
  cacheService: {
    get: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    delete: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    ping: jest.fn<() => Promise<string>>().mockResolvedValue('ok'),
  },
}));

await import('../db/connection.js');
const { default: app } = await import('../app.js');

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
      rows: [{
        email_enabled: true,
        sms_enabled: false,
        phone: '+15551234567',
        per_type_overrides: { repayment_due: true, loan_approved: false },
      }],
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
