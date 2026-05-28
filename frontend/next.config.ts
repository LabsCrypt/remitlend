import { execSync } from "child_process";
import createNextIntlPlugin from "next-intl/plugin";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import withSerwistInit from "@serwist/next";
import packageJson from "./package.json" with { type: "json" };

/* ── Build-time environment variables ────────────────────────────────── */
function getCommitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "local";
  }
}

const commitSha = getCommitSha();
const appVersion = packageJson.version;
const stellarNetwork = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";

const withNextIntl = createNextIntlPlugin("./i18n.config.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
});

const nextConfig: NextConfig = {
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_STELLAR_NETWORK: stellarNetwork,
  },
};

const config = withSerwist(nextConfig);

export default withNextIntl(
  withSentryConfig(config, {
    silent: !process.env.CI,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    sourcemaps: {
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
    autoInstrumentServerFunctions: true,
  }),
);
