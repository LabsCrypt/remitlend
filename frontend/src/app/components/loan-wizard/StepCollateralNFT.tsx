"use client";

import { Shield, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card";
import type { LoanWizardData } from "./LoanApplicationWizard";

function getScoreBandLabel(score: number): string {
  if (score >= 750) return "Excellent";
  if (score >= 670) return "Good";
  if (score >= 580) return "Fair";
  if (score >= 500) return "Poor";
  return "Below minimum";
}

function getScoreBandColor(score: number): string {
  if (score >= 750) return "text-green-600 dark:text-green-400";
  if (score >= 670) return "text-blue-600 dark:text-blue-400";
  if (score >= 580) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

interface StepCollateralNFTProps {
  data: LoanWizardData;
  onChange: (updates: Partial<LoanWizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepCollateralNFT({ data, onChange, onNext, onBack }: StepCollateralNFTProps) {
  const nftContractId =
    process.env.NEXT_PUBLIC_NFT_CONTRACT_ID ??
    process.env.NEXT_PUBLIC_MANAGER_CONTRACT_ID ??
    "Not configured";

  const scoreBandLabel = getScoreBandLabel(data.creditScore);
  const scoreBandColor = getScoreBandColor(data.creditScore);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Shield className="h-5 w-5 text-indigo-500" />
            Collateral & NFT Link
          </CardTitle>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Your RemittanceNFT is used as on-chain collateral, backed by your credit history.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* NFT Card */}
          <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-violet-950/30">
            {/* Badge */}
            <div className="absolute right-4 top-4 rounded-full bg-indigo-100 px-2.5 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
              RemittanceNFT
            </div>

            <div className="space-y-4">
              {/* Score display */}
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-indigo-500 dark:text-indigo-400">
                  Credit Score
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-5xl font-bold text-zinc-900 dark:text-zinc-50">
                    {data.creditScore}
                  </span>
                  <span className={`text-base font-semibold ${scoreBandColor}`}>
                    {scoreBandLabel}
                  </span>
                </div>
              </div>

              {/* Score bar */}
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-red-500 via-yellow-400 to-green-500"
                    style={{
                      width: `${Math.min(100, ((data.creditScore - 300) / (850 - 300)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                  <span>300</span>
                  <span>850</span>
                </div>
              </div>

              {/* Contract ref */}
              <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                <span>NFT Contract:</span>
                <code className="rounded bg-white/60 px-1.5 py-0.5 font-mono text-[10px] dark:bg-zinc-900/60">
                  {nftContractId !== "Not configured"
                    ? `${nftContractId.slice(0, 8)}…${nftContractId.slice(-6)}`
                    : nftContractId}
                </code>
                {nftContractId !== "Not configured" && (
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${nftContractId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 text-indigo-500 hover:text-indigo-600"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Explorer
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* What collateral means */}
          <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="font-medium text-zinc-700 dark:text-zinc-300">How NFT collateral works</p>
            <ul className="mt-2 space-y-2 text-sm text-zinc-500 dark:text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                Your RemittanceNFT is locked as on-chain collateral when the loan is active.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                On successful repayment, the NFT is released and your credit score increases.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                Your NFT encodes your full repayment history — it cannot be transferred while a loan
                is active.
              </li>
            </ul>
          </div>

          {/* Default warning */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/50 dark:bg-amber-950/30">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm text-amber-700 dark:text-amber-300">
              <p className="font-medium">Default consequences</p>
              <p className="mt-1 text-amber-600 dark:text-amber-400">
                If the loan is not repaid by the due date, your RemittanceNFT may be seized by the
                lending pool and your credit score will be reduced.
              </p>
            </div>
          </div>

          {/* Confirmation checkbox */}
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-zinc-200 p-4 transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900/50">
            <input
              type="checkbox"
              checked={data.collateralConfirmed}
              onChange={(e) => onChange({ collateralConfirmed: e.target.checked })}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-indigo-600"
              required
            />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              I understand that my RemittanceNFT will be used as on-chain collateral for this loan.
              I accept the terms and the consequences of default.{" "}
              <span className="text-red-600">*</span>
            </span>
          </label>

          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-2">
            <span className="text-red-600">*</span> Required field
          </p>

          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack} className="w-full">
              Back
            </Button>
            <Button onClick={onNext} disabled={!data.collateralConfirmed} className="w-full">
              Continue to Signature
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
