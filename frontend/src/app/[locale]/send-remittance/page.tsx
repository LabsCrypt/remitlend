"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RemittanceForm } from "../../components/remittance/RemittanceForm";
import { useWalletStore, selectIsWalletConnected } from "../../stores/useWalletStore";
import { ErrorBoundary } from "../../components/global_ui/ErrorBoundary";

export default function SendRemittancePage() {
  const router = useRouter();
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
            Back
          </button>
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">Send Remittance</h1>
            <p className="text-zinc-600 dark:text-zinc-400 mt-2">
              Transfer funds globally using the Stellar blockchain
            </p>
          </div>
        </div>

        {/* Error if wallet not connected */}
        {!isConnected && (
          <ErrorBoundary scope="wallet connection warning" variant="section">
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
              <p className="text-sm text-amber-800 dark:text-amber-300">
                ⚠️ Please connect your Stellar wallet to send remittances
              </p>
            </div>
          </ErrorBoundary>
        )}

        {/* Success Message */}
        {isSubmitted && (
          <ErrorBoundary scope="success message" variant="section">
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
              <p className="text-sm text-green-800 dark:text-green-300">
                ✓ Remittance sent successfully! Redirecting to remittances page...
              </p>
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
              Frequently Asked Questions
            </h2>

            <div className="space-y-4">
              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>What is a Stellar address?</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  A Stellar address is a 56-character public key that uniquely identifies a Stellar
                  account. It always starts with the letter &apos;G&apos; and is used to receive
                  payments on the Stellar network.
                </p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>How long does a remittance take?</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Stellar transactions are typically confirmed within 3-5 seconds. Your remittance
                  will appear in the recipient&apos;s account almost instantly after blockchain
                  confirmation.
                </p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>Are there transaction fees?</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Stellar network fees are minimal (typically 0.00001 XLM per operation). Additional
                  fees may apply depending on your service provider. Review the transaction preview
                  before confirming.
                </p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>Do remittances improve my credit score?</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Yes! Each successful remittance demonstrates financial activity and helps build
                  your on-chain credit history, which can improve your credit score and loan
                  eligibility.
                </p>
              </details>

              <details className="group rounded-lg border border-zinc-200 dark:border-zinc-800 p-4">
                <summary className="flex cursor-pointer items-center justify-between font-medium text-zinc-900 dark:text-zinc-50">
                  <span>What if I enter the wrong address?</span>
                  <span className="text-zinc-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  Always verify the recipient address carefully before confirming. The transaction
                  preview allows you to review the recipient address before sending. Once sent on
                  the blockchain, transactions cannot be reversed.
                </p>
              </details>
            </div>
          </div>
        </ErrorBoundary>

        {/* Footer Links */}
        <div className="mt-12 pt-6 border-t border-zinc-200 dark:border-zinc-800 text-center">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Need help?
            <a
              href="#"
              className="ml-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 focus-visible:ring-2 focus-visible:ring-focus-ring rounded px-1"
            >
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
