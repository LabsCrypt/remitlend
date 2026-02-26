import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();
import simulationRoutes from "./routes/simulationRoutes.js";
import scoreRoutes from "./routes/scoreRoutes.js";
import loanRoutes from "./routes/loanRoutes.js";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./config/swagger.js";
import { globalRateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { asyncHandler } from "./middleware/asyncHandler.js";
import { AppError } from "./errors/AppError.js";
const app = express();

const isProduction = process.env.NODE_ENV === "production";

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
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

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim())
  : [];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());
app.use(globalRateLimiter);
app.use(requestLogger);

app.get("/", (req: Request, res: Response) => {
  res.send("RemitLend Backend is running");
});

app.get("/health", (req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

app.use("/api", simulationRoutes);
app.use("/api/score", scoreRoutes);
app.use("/api/loans", loanRoutes);

// ── Diagnostic / Test Routes ─────────────────────────────────────
// Only exposed in test environment to verify centralized error handling.
if (process.env.NODE_ENV === "test") {
  app.get("/test/error/operational", () => {
    throw AppError.badRequest("Diagnostic operational error");
  });

  app.get("/test/error/internal", () => {
    throw AppError.internal("Diagnostic internal error");
  });

  app.get("/test/error/unexpected", () => {
    throw new Error("Diagnostic unexpected exception");
  });

  app.get(
    "/test/error/async",
    asyncHandler(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("Diagnostic async exception");
    }),
  );
}

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── 404 Catch-All ────────────────────────────────────────────────
// Must be placed after all route definitions so that only truly
// unmatched paths trigger a not-found error.
// Express 5 uses path-to-regexp v8 which requires named params,
// so we use a standard middleware function instead of app.all('*').
app.use((req: Request, _res: Response, next: NextFunction) => {
  next(AppError.notFound(`Cannot ${req.method} ${req.path}`));
});

// ── Global Error Handler ─────────────────────────────────────────
// Must be the LAST middleware registered so it catches every error
// forwarded via next(err) from routes and other middleware.
app.use(errorHandler);

export default app;
