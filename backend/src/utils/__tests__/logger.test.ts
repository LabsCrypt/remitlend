import { jest } from '@jest/globals';

describe('logger level resolution', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('uses LOG_LEVEL when set to a valid level', async () => {
    process.env.LOG_LEVEL = 'warn';
    jest.resetModules();
    const { default: logger } = await import('../logger.js');
    expect(logger.level).toBe('warn');
  });

  it('falls back to the NODE_ENV default when LOG_LEVEL is unset', async () => {
    delete process.env.LOG_LEVEL;
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const { default: logger } = await import('../logger.js');
    // Non-development environments default to 'http' so priority 3 (http)
    // logs pass through in staging/production (see logger.ts:17).
    expect(logger.level).toBe('http');
  });

  it('falls back to the NODE_ENV default when LOG_LEVEL is invalid', async () => {
    process.env.LOG_LEVEL = 'verbose';
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const { default: logger } = await import('../logger.js');
    expect(logger.level).toBe('debug');
  });

  it('is case-insensitive when matching LOG_LEVEL', async () => {
    process.env.LOG_LEVEL = 'ERROR';
    jest.resetModules();
    const { default: logger } = await import('../logger.js');
    expect(logger.level).toBe('error');
  });
});

type TransformableFormat = {
  transform: (info: Record<string, unknown>) => Record<string, unknown>;
};

const transform = (format: unknown, info: Record<string, unknown>) =>
  (format as TransformableFormat).transform(info);

describe('log PII redaction', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  const buildInfo = () => ({
    level: 'info',
    message: 'loan approved',
    email: 'borrower@example.com',
    phone: '+14155551234',
    'x-api-key': 'secret-api-key',
    nested: {
      authorization: 'Bearer token-value',
      recipient_name: 'Jane Doe',
      safe: 'kept',
    },
    items: [{ token: 'nested-token', signature: 'signed-payload' }],
  });

  it('redacts PII by default without LOG_REDACTION being set', async () => {
    delete process.env.LOG_REDACTION;
    jest.resetModules();
    const { redactPiiFormat } = await import('../logger.js');

    const result = transform(redactPiiFormat(), buildInfo());

    expect(result.email).toBe('[REDACTED]');
    expect(result.phone).toBe('[REDACTED]');
    expect(result['x-api-key']).toBe('[REDACTED]');
    expect(result.nested).toEqual({
      authorization: '[REDACTED]',
      recipient_name: '[REDACTED]',
      safe: 'kept',
    });
    expect(result.items).toEqual([{ token: '[REDACTED]', signature: '[REDACTED]' }]);
    // The log line itself is preserved so operational logs stay readable.
    expect(result.message).toBe('loan approved');
  });

  it('redacts a nested message body but not the top-level log line', async () => {
    delete process.env.LOG_REDACTION;
    jest.resetModules();
    const { redactPiiFormat } = await import('../logger.js');

    const result = transform(redactPiiFormat(), {
      level: 'info',
      message: 'notification dispatched',
      meta: { message: 'Your loan of 500 USDC was approved', secret: 's3cr3t' },
    });

    expect(result.message).toBe('notification dispatched');
    expect(result.meta).toEqual({ message: '[REDACTED]', secret: '[REDACTED]' });
  });

  it('applies redaction in the dev format', async () => {
    delete process.env.LOG_REDACTION;
    jest.resetModules();
    const { devFormat } = await import('../logger.js');

    const result = transform(devFormat, buildInfo());

    expect(result.email).toBe('[REDACTED]');
    expect(result.nested).toEqual({
      authorization: '[REDACTED]',
      recipient_name: '[REDACTED]',
      safe: 'kept',
    });
  });

  it('applies redaction in the production JSON format', async () => {
    delete process.env.LOG_REDACTION;
    jest.resetModules();
    const { productionFormat } = await import('../logger.js');

    const result = transform(productionFormat, buildInfo());

    expect(result.email).toBe('[REDACTED]');
    expect(result.items).toEqual([{ token: '[REDACTED]', signature: '[REDACTED]' }]);
  });

  it('replaces circular metadata instead of throwing', async () => {
    delete process.env.LOG_REDACTION;
    jest.resetModules();
    const { redactPiiFormat } = await import('../logger.js');

    const circular: Record<string, unknown> = { email: 'looped@example.com' };
    circular.self = circular;

    const result = transform(redactPiiFormat(), {
      level: 'info',
      message: 'circular payload',
      context: circular,
    });

    expect(result.context).toEqual({ email: '[REDACTED]', self: '[Circular]' });
  });
});
