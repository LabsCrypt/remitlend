import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const createRateLimiter = (max: number, windowMinutes: number = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    message: { error: "Too many requests, please try again later." },
  });

export const globalRateLimiter = createRateLimiter(100);
export const strictRateLimiter = createRateLimiter(10, 45);

export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    success: false,
    message: "Too many challenge requests, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip ?? "unknown")}:${req.body?.publicKey ?? "unknown"}`,
  message: {
    success: false,
    message: "Too many login attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

export const ipLoginRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  message: {
    success: false,
    message: "Too many login attempts from this IP, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    res.setHeader("Retry-After", Math.ceil(options.windowMs / 1000));
    res.status(429).json(options.message);
  },
});

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many verification attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});
