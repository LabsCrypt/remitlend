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
    expect(logger.level).toBe('info');
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
