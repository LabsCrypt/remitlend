import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
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
    // Capture a sample of traces for performance monitoring
    tracesSampleRate: NODE_ENV === "production" ? 0.2 : 1.0,
    // Replay only in production at a low rate to minimise data volume
    replaysOnErrorSampleRate: 1.0,
    replaysSessionSampleRate: NODE_ENV === "production" ? 0.05 : 0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    enabled: NODE_ENV !== "test",
  });
}
