import rateLimit from "express-rate-limit";

export const createRateLimiter = (max: number, windowMinutes: number = 15) =>
    rateLimit({
        windowMs: windowMinutes * 60 * 1000,
        max,
        message: { error: "Too many requests, please try again later." },
    });

export const globalRateLimiter = createRateLimiter(100);
export const strictRateLimiter = createRateLimiter(10, 45);