"use client";

import { useTranslations } from "next-intl";

/**
 * Displays a minimal build-info footer: version · network · commit SHA.
 *
 * All values come from NEXT_PUBLIC_* env vars injected at build time,
 * so there are no hydration mismatches.
 *
 * TODO: fetch /version from the backend API once the endpoint exists.
 */
export default function BuildInfoFooter() {
  const t = useTranslations("BuildInfo");

  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
  const sha = process.env.NEXT_PUBLIC_COMMIT_SHA ?? "local";

  return (
    <footer aria-label={t("ariaLabel")} className="print:hidden mt-8">
      <div className="mx-auto max-w-7xl px-4 pb-4 sm:px-6 lg:px-8">
        <p className="text-center text-xs text-muted-foreground">
          {t("label", { version, network, sha })}
        </p>
      </div>
    </footer>
  );
}
