import rateLimit from "express-rate-limit";

export const createRateLimiter = (max: number, windowMinutes: number = 15) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    message: { error: "Too many requests, please try again later." },
  });

export const globalRateLimiter = createRateLimiter(100);
export const strictRateLimiter = createRateLimiter(10, 45);

export const challengeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many challenge requests" },
  standardHeaders: true,
  legacyHeaders: false,
});

export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many verification attempts" },
  standardHeaders: true,
  legacyHeaders: false,
});
