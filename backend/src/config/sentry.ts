import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || "development";

const ENVIRONMENT_MAP: Record<string, string> = {
  production: "production",
  staging: "staging",
  development: "development",
  test: "test",
};

export function initSentry(): void {
  if (!SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT_MAP[NODE_ENV] ?? NODE_ENV,
    // Only enable performance tracing in non-test environments
    tracesSampleRate: NODE_ENV === "production" ? 0.2 : 1.0,
    // Disable Sentry in test environment to avoid noise
    enabled: NODE_ENV !== "test",
  });
}

export { Sentry };
