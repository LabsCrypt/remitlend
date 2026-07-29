import * as Sentry from '@sentry/node';
import type { ErrorEvent, EventHint } from '@sentry/node';

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';

const ENVIRONMENT_MAP: Record<string, string> = {
  production: 'production',
  staging: 'staging',
  development: 'development',
  test: 'test',
};

const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key'];

const SENSITIVE_FIELDS = [
  'secret',
  'apiKey',
  'password',
  'token',
  'jwt',
  'signedTx',
  'signedTxXdr',
  'publicKey',
  'privateKey',
  'walletAddress',
  'borrowerPublicKey',
];

function scrubValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, seen));
  }

  const scrubbed = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(scrubbed)) {
    if (SENSITIVE_FIELDS.includes(key) || SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      scrubbed[key] = '[REDACTED]';
    } else if (typeof scrubbed[key] === 'object' && scrubbed[key] !== null) {
      scrubbed[key] = scrubValue(scrubbed[key], seen);
    }
  }

  return scrubbed;
}

/**
 * Strips Authorization headers, JWT/session cookies, and known PII field
 * names from an event before it is sent to Sentry.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  if (event.request) {
    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers) as Record<string, string>;
    }
    if (event.request.cookies) {
      // Cookies may carry session/JWT values under arbitrary names, so redact
      // every cookie wholesale rather than matching against a field-name list.
      event.request.cookies = Object.fromEntries(
        Object.keys(event.request.cookies).map((name) => [name, '[REDACTED]']),
      );
    }
    if (event.request.data) {
      event.request.data = scrubValue(event.request.data);
    }
  }

  if (event.user) {
    event.user = scrubValue(event.user) as Sentry.User;
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.contexts) {
    event.contexts = scrubValue(event.contexts) as Record<string, Record<string, unknown>>;
  }

  return event;
}

export function initSentry(): void {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT_MAP[NODE_ENV] ?? NODE_ENV,
    // Only enable performance tracing in non-test environments
    tracesSampleRate: NODE_ENV === 'production' ? 0.2 : 1.0,
    // Disable Sentry in test environment to avoid noise
    enabled: NODE_ENV !== 'test',
    beforeSend(event: ErrorEvent, _hint: EventHint) {
      return scrubEvent(event);
    },
  });
}

export { Sentry };
