"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { RemittanceForm } from "../../components/remittance/RemittanceForm";
import { useWalletStore, selectIsWalletConnected } from "../../stores/useWalletStore";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";

export default function SendRemittancePage() {
  const router = useRouter();
  const t = useTranslations("SendRemittance");
  const isConnected = useWalletStore(selectIsWalletConnected);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSuccess = () => {
    setIsSubmitted(true);
    // Redirect to remittances page after 2 seconds
    setTimeout(() => {
      router.push("/remittances");
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {/* Header and Back Button */}
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 mb-4 focus-visible:ring-2 focus-visible:ring-focus-ring rounded px-1"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("backButton")}
          </button>
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">{t("title")}</h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-2">{t("description")}</p>
          </div>
        </div>

        {/* Error if wallet not connected */}
        {!isConnected && (
          <ErrorBoundary scope="wallet connection warning" variant="section">
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {t("walletNotConnected")}
              </p>
            </div>
          </ErrorBoundary>
        )}

        {/* Success Message */}
        {isSubmitted && (
          <ErrorBoundary scope="success message" variant="section">
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-800 dark:text-green-300">{t("successMessage")}</p>
            </div>
          </ErrorBoundary>
        )}

        {/* Main Form */}
        <ErrorBoundary scope="remittance form" variant="section">
          <RemittanceForm onSuccess={handleSuccess} />
        </ErrorBoundary>

        {/* FAQ Section */}
        <ErrorBoundary scope="faq section" variant="section">
          <div className="mt-12 space-y-6">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t("faq.title")}
            </h2>

            <div className="space-y-4">
              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>{t("faq.q1")}</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("faq.a1")}</p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>{t("faq.q2")}</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("faq.a2")}</p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>{t("faq.q3")}</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("faq.a3")}</p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>{t("faq.q4")}</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("faq.a4")}</p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>{t("faq.q5")}</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{t("faq.a5")}</p>
              </details>
            </div>
          </div>
        </ErrorBoundary>

        {/* Footer Links */}
        <div className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("helpFooter")}
            <a
              href="#"
              className="ml-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-visible:ring-2 focus-visible:ring-focus-ring rounded px-1"
            >
              {t("contactSupport")}
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
