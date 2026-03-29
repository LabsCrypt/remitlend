import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || "development";

const ENVIRONMENT_MAP: Record<string, string> = {
  production: "production",
  staging: "staging",
  development: "development",
  test: "test",
};

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: ENVIRONMENT_MAP[NODE_ENV] ?? NODE_ENV,
    tracesSampleRate: NODE_ENV === "production" ? 0.2 : 1.0,
    enabled: NODE_ENV !== "test",
  });
}
