import type { ErrorEvent } from '@sentry/node';
import { scrubEvent } from '../sentry.js';

describe('scrubEvent', () => {
  it('redacts Authorization headers and cookies from request context', () => {
    const event = {
      request: {
        headers: {
          Authorization: 'Bearer fake.jwt.token',
          'x-api-key': 'super-secret-key',
          'user-agent': 'jest-test',
        },
        cookies: {
          session: 'fake-session-jwt',
        },
        data: {
          password: 'hunter2',
          publicKey: 'GABCDEF1234567890',
          amount: 100,
        },
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request?.headers?.Authorization).toBe('[REDACTED]');
    expect(scrubbed.request?.headers?.['x-api-key']).toBe('[REDACTED]');
    expect(scrubbed.request?.headers?.['user-agent']).toBe('jest-test');
    expect((scrubbed.request?.cookies as Record<string, string>).session).toBe('[REDACTED]');
    expect((scrubbed.request?.data as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((scrubbed.request?.data as Record<string, unknown>).publicKey).toBe('[REDACTED]');
    expect((scrubbed.request?.data as Record<string, unknown>).amount).toBe(100);
  });

  it('redacts PII fields nested in user and extra context', () => {
    const event = {
      user: {
        id: 'user-1',
        walletAddress: 'GABC...XYZ',
      },
      extra: {
        nested: {
          jwt: 'fake.jwt.value',
          note: 'not sensitive',
        },
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect((scrubbed.user as Record<string, unknown>).walletAddress).toBe('[REDACTED]');
    expect((scrubbed.user as Record<string, unknown>).id).toBe('user-1');
    const extra = scrubbed.extra as { nested: Record<string, unknown> };
    expect(extra.nested.jwt).toBe('[REDACTED]');
    expect(extra.nested.note).toBe('not sensitive');
  });

  it('is a no-op when no sensitive data is present', () => {
    const event = {
      request: {
        headers: { 'content-type': 'application/json' },
      },
      message: 'Something broke',
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request?.headers?.['content-type']).toBe('application/json');
    expect(scrubbed.message).toBe('Something broke');
  });
});
