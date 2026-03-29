import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const withNextIntl = createNextIntlPlugin("./i18n.config.ts");
const withBundleAnalyzer = require("@next/bundle-analyzer")({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default withNextIntl(
  withBundleAnalyzer(
    withSentryConfig(nextConfig, {
      // Suppresses Sentry CLI output during build
      silent: !process.env.CI,
      // Upload source maps only when SENTRY_AUTH_TOKEN is present
      authToken: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // Disable source map upload if auth token is not configured
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
      // Automatically instrument Next.js data fetching methods
      autoInstrumentServerFunctions: true,
    }),
  ),
);
