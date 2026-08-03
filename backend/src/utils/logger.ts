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

const REDACTED_FIELDS = [
  'recipient_email',
  'recipient_phone',
  'recipient_name',
  'authorization',
  'Authorization',
  'email',
  'phone',
  'legalName',
  'pii',
];

const redactPiiFormat = winston.format((info) => {
  if (process.env.LOG_REDACTION !== 'strict') return info;
  for (const field of REDACTED_FIELDS) {
    if (field in info) {
      (info as Record<string, unknown>)[field] = '[REDACTED]';
    }
  }
  if (info.meta && typeof info.meta === 'object') {
    const meta = info.meta as Record<string, unknown>;
    for (const field of REDACTED_FIELDS) {
      if (field in meta) {
        meta[field] = '[REDACTED]';
      }
    }
  }
  return info;
});

/** Dev: human-readable with colors and optional metadata */
const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${timestamp} ${level}: ${message}${metaStr}${stackStr}`;
  }),
);

/** Production: JSON for parsing and querying */
const productionFormat = winston.format.combine(
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
