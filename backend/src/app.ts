import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Sentry } from './config/sentry.js';
import { mountSwaggerDocs } from './config/swagger.js';

dotenv.config();
import pool from './db/connection.js';
import { cacheService } from './services/cacheService.js';
import { sorobanService } from './services/sorobanService.js';
import simulationRoutes from './routes/simulationRoutes.js';
import scoreRoutes from './routes/scoreRoutes.js';
import loanRoutes from './routes/loanRoutes.js';
import poolRoutes from './routes/poolRoutes.js';
import indexerRoutes from './routes/indexerRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import notificationsRoutes from './routes/notificationsRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import remittanceRoutes from './routes/remittanceRoutes.js';
import transactionRoutes from './routes/transactionRoutes.js';
import { requireApiKey } from './middleware/auth.js';
import { globalRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import { metricsHandler, metricsMiddleware } from './middleware/metrics.js';
import { requestLogger } from './middleware/requestLogger.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { asyncHandler } from './utils/asyncHandler.js';
import { AppError } from './errors/AppError.js';
const app = express();

const isProduction = process.env.NODE_ENV === 'production';
const configuredFrontendUrl = process.env.FRONTEND_URL?.trim();

if (isProduction && !configuredFrontendUrl) {
  throw new Error('FRONTEND_URL environment variable is required in production');
}

// `CORS_ALLOWED_ORIGINS` is retained as a migration fallback while `FRONTEND_URL`
// becomes the primary documented config for the frontend origin.
const additionalAllowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
  : [];

const allowedOriginsList = [configuredFrontendUrl, ...additionalAllowedOrigins].filter(
  (origin): origin is string => Boolean(origin),
);

if (isProduction && allowedOriginsList.length === 0) {
  throw new Error('No allowed origins configured for CORS in production. Set FRONTEND_URL.');
}

const allowedOrigins = new Set(allowedOriginsList);

// In non-production environments, additionally allow common localhost origins
// used during development. Without this, staging/preview deployments that run
// with NODE_ENV !== 'production' would blindly reflect every origin.
const devOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
]);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "https:", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "font-src": ["'self'", "https:", "data:"],
        "frame-ancestors": ["'self'"],
      },
    },
    strictTransportSecurity: isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  }),
);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    if (!isProduction && devOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(AppError.forbidden('Origin is not allowed by CORS policy'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id', 'Idempotency-Key'],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());
app.use(globalRateLimiter);
app.use(requestIdMiddleware);
app.use(requestLogger);
app.use(metricsMiddleware);

app.get('/', (_req: Request, res: Response) => {
  res.send('RemitLend Backend is running');
});

/**
 * GET /version
 *
 * Read-only endpoint for operators and runbooks.
 * Returns build metadata and on-chain contract IDs so that the exact
 * backend version deployed can be determined without shelling into the container.
 *
 * Environment variables (injected at Docker build time via ARG/ENV):
 *   GIT_SHA    — full git commit SHA of the build (falls back to "unknown")
 *   BUILD_TIME — ISO-8601 UTC timestamp of the build (falls back to "unknown")
 */
app.get('/version', (_req: Request, res: Response) => {
  res.json({
    gitSha: process.env.GIT_SHA ?? 'unknown',
    builtAt: process.env.BUILD_TIME ?? 'unknown',
    nodeVersion: process.version,
    contracts: {
      loanManager: process.env.LOAN_MANAGER_CONTRACT_ID ?? 'unknown',
      lendingPool: process.env.LENDING_POOL_CONTRACT_ID ?? 'unknown',
      remittanceNft: process.env.REMITTANCE_NFT_CONTRACT_ID ?? 'unknown',
      multisigGovernance: process.env.MULTISIG_GOVERNANCE_CONTRACT_ID ?? 'unknown',
    },
  });
});

app.get(
  '/health',
  asyncHandler(async (_req: Request, res: Response) => {
    const [databaseStatus, redisStatus, sorobanStatus] = await Promise.allSettled([
      pool
        .query('SELECT 1')
        .then(() => 'ok' as const)
        .catch(() => 'error' as const),
      cacheService.ping(),
      sorobanService.ping(),
    ]);

    const dbChecks = {
      database: databaseStatus.status === 'fulfilled' ? databaseStatus.value : 'error',
      redis: redisStatus.status === 'fulfilled' ? redisStatus.value : 'error',
    };

    const checks = {
      api: 'ok' as const,
      ...dbChecks,
      soroban_rpc: sorobanStatus.status === 'fulfilled' ? sorobanStatus.value : 'error',
    };

    const coreOk = Object.values(dbChecks).every((c) => c === 'ok');
    const allOk = coreOk && checks.soroban_rpc === 'ok';

    res.status(coreOk ? 200 : 503).json({
      status: allOk ? 'ok' : coreOk ? 'degraded' : 'down',
      checks,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  }),
);

app.get(
  "/metrics",
  requireApiKey("admin:indexer"),
  asyncHandler(metricsHandler),
);

/**
 * GET /health/deep
 * Exercises DB, Redis, Stellar RPC, and indexer lag.
 * Returns 200 when all green, 503 when any dependency is down,
 * 200 with status "degraded" when indexer lag exceeds INDEXER_HEALTH_LAG_LIMIT.
 */
app.get(
  '/health/deep',
  asyncHandler(async (_req: Request, res: Response) => {
    const TIMEOUT_MS = 2000;
    const INDEXER_HEALTH_LAG_LIMIT = Number.parseInt(
      process.env.INDEXER_HEALTH_LAG_LIMIT ?? '100',
      10,
    );

    const withTimeout = <T>(promise: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
      ]);

    const [dbResult, redisResult, rpcResult, indexerResult] = await Promise.allSettled([
      withTimeout(
        pool
          .query('SELECT 1')
          .then(() => ({ status: 'ok' as const }))
          .catch(() => ({ status: 'down' as const })),
        { status: 'down' as const },
      ),
      withTimeout(
        cacheService.ping().then((r) => ({
          status: r === 'ok' ? ('ok' as const) : ('down' as const),
        })),
        { status: 'down' as const },
      ),
      withTimeout(
        sorobanService.healthCheck().then((r) => ({
          status: r.connected ? ('ok' as const) : ('down' as const),
          latestLedger: r.latestLedger,
        })),
        { status: 'down' as const, latestLedger: undefined },
      ),
      withTimeout(
        pool
          .query('SELECT last_indexed_ledger FROM indexer_state ORDER BY id DESC LIMIT 1')
          .then((r) => ({
            lastIndexedLedger: r.rows[0]?.last_indexed_ledger ?? null,
          }))
          .catch(() => ({ lastIndexedLedger: null })),
        { lastIndexedLedger: null },
      ),
    ]);

    const db = dbResult.status === 'fulfilled' ? dbResult.value.status : 'down';
    const redis = redisResult.status === 'fulfilled' ? redisResult.value.status : 'down';
    const rpcData =
      rpcResult.status === 'fulfilled'
        ? rpcResult.value
        : { status: 'down' as const, latestLedger: undefined };
    const stellarRpc = rpcData.status;
    const rpcLedger = (rpcData as { latestLedger?: number }).latestLedger;

    const indexerData =
      indexerResult.status === 'fulfilled' ? indexerResult.value : { lastIndexedLedger: null };
    const lagLedgers =
      rpcLedger != null && indexerData.lastIndexedLedger != null
        ? rpcLedger - Number(indexerData.lastIndexedLedger)
        : null;
    const indexerStatus =
      lagLedgers === null
        ? ('down' as const)
        : lagLedgers > INDEXER_HEALTH_LAG_LIMIT
          ? ('degraded' as const)
          : ('ok' as const);

    const anyDown = db === 'down' || redis === 'down' || stellarRpc === 'down';
    const overallStatus = anyDown ? 'down' : indexerStatus === 'degraded' ? 'degraded' : 'ok';

    res.status(anyDown ? 503 : 200).json({
      status: overallStatus,
      checks: {
        db,
        redis,
        stellarRpc,
        indexer: {
          status: indexerStatus,
          lagLedgers,
        },
      },
      timestamp: Date.now(),
    });
  }),
);

// Legacy routes (deprecated, maintained for backward compatibility)
app.use('/api', simulationRoutes);
app.use('/api/score', scoreRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/pool', poolRoutes);
app.use('/api/indexer', indexerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/remittances', remittanceRoutes);
app.use('/api/transactions', transactionRoutes);

// Versioned API routes (v1 - current)
app.use('/api/v1', simulationRoutes);
app.use('/api/v1/score', scoreRoutes);
app.use('/api/v1/loans', loanRoutes);
app.use('/api/v1/indexer', indexerRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/remittances', remittanceRoutes);
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/pool', poolRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/events', eventRoutes);
app.use('/user', userRoutes);

mountSwaggerDocs(app);

// ── Diagnostic / Test Routes ─────────────────────────────────────
// Only exposed in test environment to verify centralized error handling.
if (process.env.NODE_ENV === 'test') {
  app.get('/test/error/operational', () => {
    throw AppError.badRequest('Diagnostic operational error');
  });

  app.get('/test/error/internal', () => {
    throw AppError.internal('Diagnostic internal error');
  });

  app.get('/test/error/unexpected', () => {
    throw new Error('Diagnostic unexpected exception');
  });

  app.get(
    '/test/error/async',
    asyncHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error('Diagnostic async exception');
    }),
  );
}

// ── 404 Catch-All ────────────────────────────────────────────────
// Must be placed after all route definitions so that only truly
// unmatched paths trigger a not-found error.
// Express 5 uses path-to-regexp v8 which requires named params,
// so we use a standard middleware function instead of app.all('*').
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(AppError.notFound(`Cannot ${req.method} ${req.path}`));
});

// ── Sentry Error Handler ──────────────────────────────────────────
// Must be registered after all routes so it captures errors forwarded
// via next(err), but before the custom errorHandler so Sentry sees them.
Sentry.setupExpressErrorHandler(app);

// ── Global Error Handler ─────────────────────────────────────────
// Must be the LAST middleware registered so it catches every error
// forwarded via next(err) from routes and other middleware.
app.use(errorHandler);

export default app;
