import winston from 'winston';
import { getRequestId } from './requestContext.js';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const validLevels = Object.keys(levels);

const defaultLevelForEnv = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'http';
};

const level = () => {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && validLevels.includes(configured)) {
    return configured;
  }
  return defaultLevelForEnv();
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'grey',
};

winston.addColors(colors);

/**
 * Field names whose values must never reach a log sink. Keys are normalised
 * (lower-cased, separators removed) before comparison, so `x-api-key`,
 * `X_API_KEY` and `xApiKey` are all treated as the same sensitive field.
 */
export const REDACTED_FIELDS = [
  'recipient_email',
  'recipient_phone',
  'recipient_name',
  'authorization',
  'email',
  'phone',
  'legalName',
  'pii',
  'signature',
  'secret',
  'token',
  'message',
  'x-api-key',
] as const;

export const REDACTED_VALUE = '[REDACTED]';

const normalizeFieldName = (field: string) => field.toLowerCase().replace(/[-_]/g, '');

const REDACTED_FIELD_NAMES = new Set(REDACTED_FIELDS.map(normalizeFieldName));

const isSensitiveField = (field: string) => REDACTED_FIELD_NAMES.has(normalizeFieldName(field));

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Recursively replaces sensitive fields with `[REDACTED]`.
 *
 * Redaction is unconditional: it is not gated by `LOG_REDACTION`, so dev,
 * staging and production all get the same protection. Arrays are walked and
 * circular references are replaced rather than causing a stack overflow.
 */
export function redactSensitiveData<T>(value: T, seen = new WeakSet<object>()): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry, seen)) as unknown as T;
  }

  if (!isPlainObject(value)) return value;

  if (seen.has(value)) return '[Circular]' as unknown as T;
  seen.add(value);

  const redacted: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = isSensitiveField(key) ? REDACTED_VALUE : redactSensitiveData(nested, seen);
  }

  return redacted as T;
}

/**
 * PII redaction format applied to every transport format.
 *
 * `message` is in the sensitive-field list so notification bodies and other
 * metadata logged under that key are stripped. The top-level `message` of a
 * winston record is the log line itself, not PII metadata, so it is restored
 * after redaction to keep operational logs readable.
 */
export const redactPiiFormat = winston.format((info) => {
  const logLine = info.message;
  const redacted = redactSensitiveData(info as Record<string, unknown>);
  redacted.message = logLine;

  for (const key of Object.keys(redacted)) {
    (info as Record<string, unknown>)[key] = redacted[key];
  }

  return info;
});

/** Dev: human-readable with colors and optional metadata */
export const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  redactPiiFormat(),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
  }),
);

/** Production: JSON for parsing and querying */
export const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'iso' }),
  winston.format.errors({ stack: true }),
  redactPiiFormat(),
  winston.format.json(),
);

const withRequestId = winston.format((info) => {
  const requestIdFromContext = getRequestId();
  if (requestIdFromContext && !info.requestId) {
    info.requestId = requestIdFromContext;
  }
  return info;
});

const isProduction = process.env.NODE_ENV === 'production';

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProduction
      ? winston.format.combine(withRequestId(), productionFormat)
      : winston.format.combine(withRequestId(), devFormat),
  }),
];

const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

export interface LogContext {
  requestId?: string;
  userId?: string;
  loanId?: string;
  [key: string]: any;
}

const withContext = (context: LogContext = {}) => {
  const requestId = context.requestId || getRequestId();
  const baseMeta: Record<string, any> = {};

  if (requestId) baseMeta.requestId = requestId;
  if (context.userId) baseMeta.userId = context.userId;
  if (context.loanId) baseMeta.loanId = context.loanId;

  return {
    info: (message: string, meta?: any) => logger.info(message, { ...baseMeta, ...meta }),
    warn: (message: string, meta?: any) => logger.warn(message, { ...baseMeta, ...meta }),
    error: (message: string, meta?: any) => logger.error(message, { ...baseMeta, ...meta }),
    http: (message: string, meta?: any) => logger.http(message, { ...baseMeta, ...meta }),
  };
};

const loggerWithContext = Object.assign(logger, { withContext });

export default loggerWithContext;
